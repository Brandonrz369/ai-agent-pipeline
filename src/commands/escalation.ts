import { getEscalationReport, formatEscalationAge, type EscalationItem } from '../escalation/index.js';

const SEVERITY_COLOR: Record<string, string> = {
  CRITICAL: '[31m',
  HIGH:     '[33m',
  MEDIUM:   '[34m',
  LOW:      '[90m',
};
const RESET = '[0m';
const BOLD  = '[1m';

function severityBadge(sev: string): string {
  const c = SEVERITY_COLOR[sev] || '';
  return c + BOLD + '[' + sev + ']' + RESET;
}

function typeLabel(type: string): string {
  const labels: Record<string, string> = {
    DEAD_LETTER:  'DEAD-LETTER ',
    HITL_PENDING: 'HITL-PENDING',
    BLOCKED:      'BLOCKED     ',
    ESCALATED:    'ESCALATED   ',
  };
  return labels[type] || type.padEnd(12);
}

function renderTable(items: EscalationItem[]): void {
  if (items.length === 0) return;
  console.log('');
  console.log('  TYPE           SEVERITY    AGE          ID');
  console.log('  ' + '-'.repeat(72));
  for (const item of items) {
    const age = item.ageMs > 0 ? formatEscalationAge(item.ageMs) : 'pending...';
    const desc = item.description
      ? '  ' + item.description.slice(0, 60) + (item.description.length > 60 ? '...' : '')
      : '';
    console.log(
      '  ' + typeLabel(item.type) + '  ' + severityBadge(item.severity).padEnd(20) + '  ' + age.padEnd(14) + '  ' + item.id.slice(0, 32)
    );
    if (desc) console.log('  ' + ' '.repeat(50) + desc.trim());
    if (item.reason && item.reason !== 'Legacy Agency task is BLOCKED') {
      console.log('  ' + ''.padEnd(50) + '  Reason: ' + item.reason.slice(0, 80));
    }
  }
}

async function renderDashboard(): Promise<number> {
  const report = await getEscalationReport();
  const ts = new Date(report.generatedAt).toLocaleString();

  console.clear();
  console.log(BOLD + '=== Pipeline Escalation Dashboard ===' + RESET + '  (' + ts + ')');
  console.log('');

  if (report.totalCount === 0) {
    console.log('  [32m✓ No escalated or stuck tasks.' + RESET);
    console.log('');
    return 0;
  }

  const critStr = report.criticalCount > 0
    ? SEVERITY_COLOR.CRITICAL + BOLD + report.criticalCount + ' CRITICAL' + RESET
    : '0 critical';
  console.log('  ' + BOLD + report.totalCount + RESET + ' items requiring attention -- ' + critStr);
  console.log('');
  console.log('  By type:');
  for (const [type, count] of Object.entries(report.byType)) {
    if (count > 0) console.log('    ' + typeLabel(type) + '  ' + count);
  }

  renderTable(report.items);
  console.log('');
  return report.criticalCount > 0 ? 2 : 1;
}

export async function escalationCommand(opts: { json?: boolean; watch?: string }): Promise<void> {
  if (opts.json) {
    const report = await getEscalationReport();
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (opts.watch) {
    const intervalSec = Math.max(5, parseInt(opts.watch, 10) || 10);
    console.log('Watching for escalations -- refresh every ' + intervalSec + 's (Ctrl-C to exit)');
    const run = async () => { await renderDashboard(); };
    await run();
    setInterval(run, intervalSec * 1000);
    return;
  }

  const exitCode = await renderDashboard();
  if (exitCode > 0) process.exitCode = exitCode;
}
