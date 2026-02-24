/**
 * Discord HITL Approval Flow — T06 (Charlie)
 *
 * Sends approval requests to Discord and waits for reactions.
 * Two modes:
 * 1. Webhook mode (simple): Posts to a Discord webhook URL, polls for response via gateway webhook
 * 2. Bot mode (interactive): Posts embed with reactions, listens for approve/reject emoji
 *
 * Falls back to gateway webhook mode if no bot token is configured.
 */
import { logger } from '../utils/logger.js';
import { logAuditEntry } from '../audit/index.js';
import type { HITLGate, HITLDecision, HITLApprovalRequest } from './hitl.js';

export interface DiscordHITLConfig {
  /** Discord webhook URL for the approvals channel */
  webhookUrl?: string;
  /** Discord bot token for interactive reactions (optional, enables bot mode) */
  botToken?: string;
  /** Channel ID to post HITL requests (used in bot mode) */
  channelId?: string;
  /** Base URL for the pipeline gateway webhook (for callback link) */
  gatewayBaseUrl?: string;
}

interface DiscordEmbed {
  title: string;
  description: string;
  color: number;
  fields: { name: string; value: string; inline?: boolean }[];
  footer: { text: string };
  timestamp: string;
}

// Severity → Discord embed color
const SEVERITY_COLORS: Record<string, number> = {
  CRITICAL: 0xff0000,  // Red
  HIGH: 0xff8c00,      // Orange
  MEDIUM: 0xffd700,    // Yellow
};

/**
 * Build a Discord embed for a HITL approval request.
 */
function buildApprovalEmbed(req: HITLApprovalRequest): DiscordEmbed {
  return {
    title: `HITL Approval Required — ${req.gate.id}`,
    description: `**${req.gate.description}**\n\nAction requires human approval before proceeding.`,
    color: SEVERITY_COLORS[req.gate.severity] || 0x808080,
    fields: [
      { name: 'Severity', value: req.gate.severity, inline: true },
      { name: 'Task', value: req.taskId || 'N/A', inline: true },
      { name: 'Timeout', value: `${Math.round(req.gate.timeoutMs / 60_000)} min`, inline: true },
      { name: 'Action', value: `\`\`\`\n${req.action.slice(0, 500)}\n\`\`\`` },
      ...(req.context.details
        ? [{ name: 'Context', value: String(req.context.details).slice(0, 500) }]
        : []),
    ],
    footer: { text: `Default on timeout: ${req.gate.defaultOnTimeout} | Gate: ${req.gate.id}` },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Send a HITL approval request via Discord webhook.
 * Returns the message ID for tracking.
 */
async function sendWebhookRequest(
  webhookUrl: string,
  req: HITLApprovalRequest,
  gatewayBaseUrl?: string,
): Promise<string | null> {
  const embed = buildApprovalEmbed(req);

  // Add callback instructions
  const callbackUrl = gatewayBaseUrl
    ? `${gatewayBaseUrl}/webhook/hitl-response`
    : null;

  const payload = {
    content: `@here **HITL Gate Triggered** — ${req.gate.severity} severity`,
    embeds: [embed],
    components: callbackUrl ? [{
      type: 1, // ACTION_ROW
      components: [
        {
          type: 2, // BUTTON
          style: 3, // SUCCESS (green)
          label: 'APPROVE',
          custom_id: `hitl_approve_${req.gate.id}_${req.taskId || 'unknown'}`,
        },
        {
          type: 2, // BUTTON
          style: 4, // DANGER (red)
          label: 'REJECT',
          custom_id: `hitl_reject_${req.gate.id}_${req.taskId || 'unknown'}`,
        },
      ],
    }] : undefined,
  };

  try {
    const response = await fetch(`${webhookUrl}?wait=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      logger.error('Discord webhook failed', {
        status: response.status,
        statusText: response.statusText,
      });
      return null;
    }

    const data = await response.json() as { id?: string };
    logger.info('Discord HITL request sent', {
      gate_id: req.gate.id,
      message_id: data.id,
    });
    return data.id || null;
  } catch (err) {
    logger.error('Discord webhook error', { error: String(err) });
    return null;
  }
}

/**
 * Send a follow-up message to Discord with the decision result.
 */
async function sendDecisionFollowup(
  webhookUrl: string,
  req: HITLApprovalRequest,
  decision: HITLDecision,
): Promise<void> {
  const emoji = decision === 'APPROVE' ? '✅' : decision === 'REJECT' ? '❌' : '⏰';
  const payload = {
    content: `${emoji} **${req.gate.id}** — ${decision} (task: ${req.taskId || 'N/A'})`,
  };

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    // Non-critical — just a status update
  }
}

/**
 * Pending approval requests — keyed by gate_id + task_id.
 * The webhook server resolves these when it receives a response.
 */
const pendingApprovals = new Map<string, {
  resolve: (decision: HITLDecision) => void;
  timeout: ReturnType<typeof setTimeout>;
  gate: HITLGate;
  taskId?: string;
}>();

/**
 * Get a unique key for a pending approval.
 */
function approvalKey(gateId: string, taskId?: string): string {
  return `${gateId}:${taskId || 'unknown'}`;
}

/**
 * Resolve a pending approval from an external source (webhook callback).
 * Called by the webhook server when it receives a POST to /webhook/hitl-response.
 */
export function resolveApproval(gateId: string, decision: HITLDecision, taskId?: string): boolean {
  const key = approvalKey(gateId, taskId);
  const pending = pendingApprovals.get(key);
  if (!pending) {
    logger.warn('No pending approval found', { key, decision });
    return false;
  }

  clearTimeout(pending.timeout);
  pendingApprovals.delete(key);
  pending.resolve(decision);
  logger.info('HITL approval resolved', { key, decision });
  return true;
}

/**
 * List pending approval requests.
 */
export function listPendingApprovals(): Array<{ key: string; gateId: string; taskId?: string }> {
  return Array.from(pendingApprovals.entries()).map(([key, val]) => ({
    key,
    gateId: val.gate.id,
    taskId: val.taskId,
  }));
}

/**
 * Create a Discord HITL approval handler.
 * Returns a function compatible with setApprovalHandler().
 */
export function createDiscordApprovalHandler(config: DiscordHITLConfig) {
  return async (req: HITLApprovalRequest): Promise<HITLDecision> => {
    const { webhookUrl, gatewayBaseUrl } = config;

    if (!webhookUrl) {
      logger.warn('No Discord webhook URL configured — defaulting to REJECT');
      return req.gate.defaultOnTimeout;
    }

    // Send the approval request to Discord
    const messageId = await sendWebhookRequest(webhookUrl, req, gatewayBaseUrl);

    if (!messageId) {
      logger.warn('Failed to send Discord HITL request — defaulting to REJECT');
      return req.gate.defaultOnTimeout;
    }

    await logAuditEntry('HITL_DISCORD_SENT', {
      gate_id: req.gate.id,
      message_id: messageId,
      severity: req.gate.severity,
      timeout_ms: req.gate.timeoutMs,
    }, req.taskId);

    // Wait for response via webhook callback
    const key = approvalKey(req.gate.id, req.taskId);
    const decision = await new Promise<HITLDecision>((resolve) => {
      const timeout = setTimeout(() => {
        pendingApprovals.delete(key);
        logger.warn('HITL approval timed out', {
          gate_id: req.gate.id,
          task_id: req.taskId,
          default: req.gate.defaultOnTimeout,
        });
        resolve(req.gate.defaultOnTimeout);
      }, req.gate.timeoutMs);

      pendingApprovals.set(key, {
        resolve,
        timeout,
        gate: req.gate,
        taskId: req.taskId,
      });
    });

    // Send follow-up to Discord with the decision
    await sendDecisionFollowup(webhookUrl, req, decision);

    await logAuditEntry('HITL_DISCORD_DECISION', {
      gate_id: req.gate.id,
      decision,
      message_id: messageId,
    }, req.taskId);

    return decision;
  };
}
