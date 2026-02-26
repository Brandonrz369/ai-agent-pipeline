import { getHealthReport } from '../health/index.js';

export async function healthCommand(opts: { json?: boolean }) {
  const report = await getHealthReport();

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const icon = report.status === 'ok' ? 'OK' : report.status === 'degraded' ? 'DEGRADED' : 'DOWN';
  console.log('=== Pipeline Health: ' + icon + ' ===\n');
  console.log('Version:   ' + report.version);
  console.log('Uptime:    ' + Math.round(report.uptime) + 's');
  console.log('Timestamp: ' + report.timestamp);
  console.log('');

  for (const [name, check] of Object.entries(report.checks)) {
    const s = check.status === 'ok' ? '[OK]' : check.status === 'degraded' ? '[DEGRADED]' : '[DOWN]';
    console.log('  ' + s + ' ' + name + ': ' + check.message);
  }
  console.log('');

  if (report.status !== 'ok') {
    process.exitCode = 1;
  }
}
