import { readAuditLog, verifyAuditLog } from '../audit/index.js';

export async function auditListCommand(opts: { date?: string }) {
  const entries = await readAuditLog(opts.date);

  if (entries.length === 0) {
    console.log(`No audit entries${opts.date ? ` for ${opts.date}` : ' today'}.`);
    return;
  }

  console.log(`Audit log: ${entries.length} entries${opts.date ? ` for ${opts.date}` : ' (today)'}\n`);
  for (const entry of entries) {
    const time = entry.timestamp.split('T')[1]?.replace('Z', '') || entry.timestamp;
    console.log(`  [${time}] ${entry.action}${entry.task_id ? ` (${entry.task_id})` : ''}`);
    if (entry.details && Object.keys(entry.details).length > 0) {
      const details = Object.entries(entry.details)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(', ');
      console.log(`           ${details}`);
    }
  }
}

export async function auditVerifyCommand(opts: { date?: string }) {
  const result = await verifyAuditLog(opts.date);

  console.log(`Audit log integrity check${opts.date ? ` for ${opts.date}` : ' (today)'}:`);
  console.log(`  Total entries: ${result.total}`);
  console.log(`  Valid (HMAC OK): ${result.valid}`);
  console.log(`  Tampered: ${result.tampered}`);

  if (result.tampered > 0) {
    console.error(`\nWARNING: ${result.tampered} entries have invalid HMAC signatures!`);
    process.exit(1);
  } else if (result.total > 0) {
    console.log('\nAll entries verified — no tampering detected.');
  }
}
