/**
 * SUPERVISE Mode Runtime Handler -- T27 (Charlie)
 *
 * screenshot+click loop for Computer Use GUI automation.
 * Accepts ComputerUseProvider interface for pluggable providers.
 * StubComputerUseProvider included for unit tests.
 */
import type {
  TaskBlueprint,
  TaskEnvelope,
  SuperviseResult,
  SuperviseConfig,
  ComputerUseProvider,
  ScreenshotAction,
} from '../types/index.js';
import { logger } from '../utils/logger.js';
import { URLAllowlist } from '../permissions/index.js';

const DEFAULT_CONFIG: SuperviseConfig = {
  maxActions: 50,
  contextOffloadEvery: 5,
  urlAllowlist: [],
  hitlApproved: false,
};

const PAYMENT_PAGE_KEYWORDS = [
  'credit card', 'card number', 'cvv', 'billing', 'purchase',
  'buy now', 'checkout', 'payment method', 'add payment',
  'subscribe', 'subscription', 'pay $', 'pay now',
];

async function offloadContext(
  taskId: string,
  offloadIndex: number,
  summary: string,
  contextOffloadFn?: (key: string, content: string) => Promise<void>,
): Promise<string> {
  const key = 'supervise-' + taskId + '-offload-' + offloadIndex;
  if (contextOffloadFn) {
    await contextOffloadFn(key, '[context offload #' + offloadIndex + ']\n' + summary);
  }
  logger.info('Context offloaded to gemini-cache', { key, offloadIndex });
  return key;
}

export function detectPaymentPage(analysisText: string): boolean {
  const lower = analysisText.toLowerCase();
  return PAYMENT_PAGE_KEYWORDS.some((kw) => lower.includes(kw));
}

export function isUrlAllowed(url: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) return false;
  return allowlist.some((allowed) => {
    try {
      const target = new URL(url);
      const base = new URL(allowed);
      return target.hostname === base.hostname
        || target.hostname.endsWith('.' + base.hostname);
    } catch {
      return url.startsWith(allowed);
    }
  });
}

export interface SuperviseHandlerOptions {
  provider: ComputerUseProvider;
  config?: Partial<SuperviseConfig>;
  contextOffloadFn?: (key: string, content: string) => Promise<void>;
  analyzeScreenshot?: (
    screenshotData: string,
    objective: string,
    history: ScreenshotAction[],
  ) => Promise<ScreenshotAction | null>;
}

export async function runSuperviseSession(
  task: TaskBlueprint,
  envelope: TaskEnvelope,
  options: SuperviseHandlerOptions,
): Promise<SuperviseResult> {
  const cfg: SuperviseConfig = Object.assign({}, DEFAULT_CONFIG, options.config);
  const allowlist = new URLAllowlist(cfg.urlAllowlist);
  const startTime = Date.now();
  const issues: string[] = [];
  if (!cfg.hitlApproved) {
    logger.warn('SUPERVISE session started without HITL approval', { task_id: task.task_id });
    issues.push('HITL-013: Session started without human approval (HITL required)');
    return { task_id: task.task_id, mode: 'SUPERVISE', status: 'FAIL', screenshots_taken: 0, actions_performed: 0, context_offloads: 0, summary: 'Aborted: HITL approval was not granted before session start.', issues, duration_ms: Date.now() - startTime };
  }
  logger.info('Starting SUPERVISE session', { task_id: task.task_id, maxActions: cfg.maxActions });
  const history: ScreenshotAction[] = [];
  let screenshotsTaken = 0;
  let actionsPerformed = 0;
  let contextOffloads = 0;
  let lastCacheKey: string | undefined;
  let status: SuperviseResult['status'] = 'FAIL';
  let finalSummary = 'Session did not complete.';
  const objective = task.task.objective;
  try {
    while (actionsPerformed < cfg.maxActions) {
      const shot = await options.provider.screenshot();
      screenshotsTaken++;
      history.push({ type: 'screenshot', description: 'Screenshot #' + screenshotsTaken });
      let nextAction: ScreenshotAction | null = null;
      if (options.analyzeScreenshot) {
        nextAction = await options.analyzeScreenshot(shot.data, objective, history);
      }
      if (nextAction === null) { status = 'PASS'; finalSummary = 'Task completed after ' + actionsPerformed + ' actions.'; break; }
      if (detectPaymentPage(nextAction.description)) {
        issues.push('SAFETY: Payment page detected at action ' + actionsPerformed + ': ' + nextAction.description);
        status = 'STUCK';
        finalSummary = 'Stopped: payment/billing page detected.';
        break;
      }
      if (nextAction.type === 'click' && nextAction.text != null && nextAction.text.startsWith('http')) {
        if (!allowlist.isAllowed(nextAction.text)) {
          issues.push('SAFETY: URL not on allowlist: ' + nextAction.text);
          status = 'STUCK';
          finalSummary = 'Stopped: navigation to disallowed URL: ' + nextAction.text;
          break;
        }
      }
      await executeAction(options.provider, nextAction);
      actionsPerformed++;
      history.push(nextAction);
      logger.debug('Executed action', { task_id: task.task_id, action: nextAction.type, actionsPerformed });
      await options.provider.screenshot();
      screenshotsTaken++;
      history.push({ type: 'screenshot', description: 'Verification #' + actionsPerformed });
      if (actionsPerformed % cfg.contextOffloadEvery === 0) {
        const offloadIndex = Math.floor(actionsPerformed / cfg.contextOffloadEvery);
        const ctxSummary = buildContextSummary(task, history.slice(-cfg.contextOffloadEvery * 2));
        lastCacheKey = await offloadContext(task.task_id, offloadIndex, ctxSummary, options.contextOffloadFn);
        contextOffloads++;
        if (history.length > cfg.contextOffloadEvery * 4) { history.splice(0, history.length - cfg.contextOffloadEvery * 4); }
      }
    }
    if (actionsPerformed >= cfg.maxActions && status === 'FAIL') {
      status = 'STUCK';
      finalSummary = 'Max actions limit (' + cfg.maxActions + ') reached without task completion.';
      issues.push('Max-actions limit of ' + cfg.maxActions + ' reached.');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('SUPERVISE session error', { task_id: task.task_id, error: message });
    issues.push('Runtime error: ' + message);
    status = 'FAIL';
    finalSummary = 'Session failed with error: ' + message;
  }
  const result: SuperviseResult = { task_id: task.task_id, mode: 'SUPERVISE', status, screenshots_taken: screenshotsTaken, actions_performed: actionsPerformed, context_offloads: contextOffloads, summary: finalSummary, issues, mcp_cache_key: lastCacheKey, duration_ms: Date.now() - startTime };
  logger.info('SUPERVISE session complete', { task_id: task.task_id, status, actionsPerformed });
  return result;
}

async function executeAction(provider: ComputerUseProvider, action: ScreenshotAction): Promise<void> {
  switch (action.type) {
    case 'click':
      if (action.x !== undefined && action.y !== undefined) { await provider.click(action.x, action.y); }
      break;
    case 'type':
      if (action.text !== undefined) { await provider.type(action.text); }
      break;
    case 'key':
      if (action.key !== undefined) { await provider.pressKey(action.key); }
      break;
    case 'scroll':
      if (action.x !== undefined && action.y !== undefined && action.scroll) {
        await provider.scroll(action.x, action.y, action.scroll.direction, action.scroll.amount);
      }
      break;
    case 'move':
      if (action.x !== undefined && action.y !== undefined) { await provider.moveMouse(action.x, action.y); }
      break;
    case 'screenshot':
      break;
    default:
      logger.warn('Unknown action type', { type: action.type });
  }
}

function buildContextSummary(task: TaskBlueprint, recentHistory: ScreenshotAction[]): string {
  const actionLines = recentHistory
    .filter((a) => a.type !== 'screenshot')
    .map((a) => '  [' + a.type + '] ' + a.description)
    .join('\n');
  return [
    'Task: ' + task.task_id,
    'Objective: ' + task.task.objective,
    'Recent actions:',
    actionLines || '  (none)',
  ].join('\n');
}

export class StubComputerUseProvider implements ComputerUseProvider {
  readonly calls: Array<{ method: string; args: unknown[] }> = [];
  private _shot = {
    data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    mimeType: 'image/png',
  };
  setScreenshotResponse(data: string, mimeType: string): void { this._shot = { data, mimeType }; }
  async screenshot(): Promise<{ data: string; mimeType: string }> { this.calls.push({ method: 'screenshot', args: [] }); return { ...this._shot }; }
  async moveMouse(x: number, y: number): Promise<void> { this.calls.push({ method: 'moveMouse', args: [x, y] }); }
  async click(x: number, y: number, button: 'left' | 'right' | 'middle' = 'left'): Promise<void> { this.calls.push({ method: 'click', args: [x, y, button] }); }
  async type(text: string): Promise<void> { this.calls.push({ method: 'type', args: [text] }); }
  async pressKey(key: string): Promise<void> { this.calls.push({ method: 'pressKey', args: [key] }); }
  async scroll(x: number, y: number, direction: 'up' | 'down' | 'left' | 'right', amount: number): Promise<void> { this.calls.push({ method: 'scroll', args: [x, y, direction, amount] }); }
  callCount(method: string): number { return this.calls.filter((c) => c.method === method).length; }
  reset(): void { this.calls.length = 0; }
}
