import { logger } from '../utils/logger.js';
import { logAuditEntry } from '../audit/index.js';

export type HITLSeverity = 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type HITLDecision = 'APPROVE' | 'REJECT' | 'TIMEOUT';

export interface HITLGate {
  id: string;
  trigger: RegExp;
  severity: HITLSeverity;
  timeoutMs: number;
  defaultOnTimeout: HITLDecision;
  description: string;
}

// HITL gates from security/hitl-gates.md
const HITL_GATES: HITLGate[] = [
  { id: 'HITL-001', trigger: /\bgit\s+push\b/i, severity: 'HIGH', timeoutMs: 30 * 60_000, defaultOnTimeout: 'REJECT', description: 'git push' },
  { id: 'HITL-002', trigger: /\bsend\s+email\b/i, severity: 'HIGH', timeoutMs: 30 * 60_000, defaultOnTimeout: 'REJECT', description: 'send email' },
  { id: 'HITL-003', trigger: /\bdeploy\s+to\s+production\b/i, severity: 'CRITICAL', timeoutMs: 60 * 60_000, defaultOnTimeout: 'REJECT', description: 'deploy to production' },
  { id: 'HITL-004', trigger: /\b(delete\s+\*|rm\s+-rf)\b/i, severity: 'CRITICAL', timeoutMs: 15 * 60_000, defaultOnTimeout: 'REJECT', description: 'destructive delete' },
  { id: 'HITL-005', trigger: /\b(drop\s+table|truncate)\b/i, severity: 'CRITICAL', timeoutMs: 15 * 60_000, defaultOnTimeout: 'REJECT', description: 'database destructive' },
  { id: 'HITL-006', trigger: /\bwrite.*external\//i, severity: 'HIGH', timeoutMs: 30 * 60_000, defaultOnTimeout: 'REJECT', description: 'write to external/' },
  { id: 'HITL-007', trigger: /\bwrite.*outbox\//i, severity: 'HIGH', timeoutMs: 30 * 60_000, defaultOnTimeout: 'REJECT', description: 'write to outbox/' },
  { id: 'HITL-010', trigger: /\bmcp.*image.*update\b/i, severity: 'HIGH', timeoutMs: 120 * 60_000, defaultOnTimeout: 'REJECT', description: 'MCP server image update' },
  { id: 'HITL-012', trigger: /\bretry.*>=?\s*2\s*failures\b/i, severity: 'MEDIUM', timeoutMs: 60 * 60_000, defaultOnTimeout: 'REJECT', description: 'batch retry >=2 failures' },
  { id: 'HITL-013', trigger: /\bcomputer.?use.*session.*start\b/i, severity: 'HIGH', timeoutMs: 30 * 60_000, defaultOnTimeout: 'REJECT', description: 'Computer Use session start' },
  { id: 'HITL-014', trigger: /\bcredential.*entry\b/i, severity: 'CRITICAL', timeoutMs: 15 * 60_000, defaultOnTimeout: 'REJECT', description: 'Computer Use credential entry' },
];

// Auto-approved actions (skip HITL)
const AUTO_APPROVED: RegExp[] = [
  /\bread\b/i,
  /\bwrite\s+reports\//i,
  /\bwrite\s+prompts\//i,
  /\bgit\s+add.*&&.*git\s+commit\b/i,
  /\bnpm\s+test\b/i,
  /\bnpx\s+ajv\s+validate\b/i,
  /\bcache\s+query\b/i,
  /\bnpx\s+eslint\b/i,
];

export interface HITLCheckResult {
  needsApproval: boolean;
  gate?: HITLGate;
  autoApproved: boolean;
}

export function checkHITL(action: string): HITLCheckResult {
  // Check auto-approved first
  for (const pattern of AUTO_APPROVED) {
    if (pattern.test(action)) {
      return { needsApproval: false, autoApproved: true };
    }
  }

  // Check HITL gates
  for (const gate of HITL_GATES) {
    if (gate.trigger.test(action)) {
      return { needsApproval: true, gate, autoApproved: false };
    }
  }

  return { needsApproval: false, autoApproved: false };
}

export interface HITLApprovalRequest {
  gate: HITLGate;
  action: string;
  taskId?: string;
  context: Record<string, unknown>;
}

// In-process approval handler — in production this would send to Discord/Telegram
let approvalHandler: ((req: HITLApprovalRequest) => Promise<HITLDecision>) | null = null;

export function setApprovalHandler(handler: (req: HITLApprovalRequest) => Promise<HITLDecision>) {
  approvalHandler = handler;
}

export async function requestApproval(
  action: string,
  taskId?: string,
  context: Record<string, unknown> = {},
): Promise<HITLDecision> {
  const check = checkHITL(action);

  if (!check.needsApproval) {
    return 'APPROVE';
  }

  const gate = check.gate!;
  logger.warn('HITL gate triggered', {
    gate_id: gate.id,
    severity: gate.severity,
    action,
    task_id: taskId,
  });

  await logAuditEntry('HITL_GATE_TRIGGERED', {
    gate_id: gate.id,
    severity: gate.severity,
    action,
  }, taskId);

  // Use custom handler if set
  if (approvalHandler) {
    const decision = await approvalHandler({ gate, action, taskId, context });
    await logAuditEntry('HITL_DECISION', {
      gate_id: gate.id,
      decision,
      action,
    }, taskId);
    return decision;
  }

  // Default: block on timeout (safe default)
  logger.warn('No HITL approval handler set — defaulting to REJECT', { gate_id: gate.id });
  return gate.defaultOnTimeout;
}
