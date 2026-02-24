import { listDeadLetter } from '../anti-loop/dead-letter.js';
import { getStoreStats } from '../mcp-servers/brain-context/index.js';
import { readAuditLog } from '../audit/index.js';

export async function statusCommand() {
  console.log('=== AI Agent Pipeline Status ===\n');

  // Environment
  console.log('Environment:');
  console.log(`  GEMINI_API_KEY: ${process.env.GEMINI_API_KEY ? 'set' : 'NOT SET'}`);
  console.log(`  Node.js: ${process.version}`);
  console.log('');

  // Dead-letter queue
  const deadLetterItems = await listDeadLetter();
  console.log(`Dead-letter queue: ${deadLetterItems.length} items`);
  if (deadLetterItems.length > 0) {
    deadLetterItems.slice(0, 3).forEach((item) => {
      console.log(`  ${item.id}: ${item.reason} (${item.sent_at})`);
    });
  }
  console.log('');

  // Brain context store
  try {
    const stats = await getStoreStats();
    console.log('Brain context store:');
    console.log(`  Entries: ${stats.totalEntries}`);
    console.log(`  Original tokens: ${stats.totalOriginalTokens}`);
    console.log(`  Compressed tokens: ${stats.totalCompressedTokens}`);
    console.log(`  Last updated: ${stats.lastUpdated}`);
  } catch {
    console.log('Brain context store: not initialized');
  }
  console.log('');

  // Audit log
  try {
    const auditEntries = await readAuditLog();
    console.log(`Audit log (today): ${auditEntries.length} entries`);
    if (auditEntries.length > 0) {
      const last = auditEntries[auditEntries.length - 1];
      console.log(`  Last: ${last.action} at ${last.timestamp}`);
    }
  } catch {
    console.log('Audit log: no entries today');
  }
}
