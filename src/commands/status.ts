import { listDeadLetter } from '../anti-loop/dead-letter.js';
import { getStoreStats } from '../mcp-servers/brain-context/index.js';
import { readAuditLog } from '../audit/index.js';
import { getSummaryMetrics } from '../monitoring/metrics.js';
import { WorkerRegistry } from '../orchestrator/registry.js';
import { loadPipelineConfig } from '../config/loader.js';

export async function statusCommand() {
  const config = await loadPipelineConfig();
  console.log('=== AI Agent Pipeline Status ===\n');

  // Environment
  console.log('Environment:');
  console.log(`  GEMINI_API_KEY: ${process.env.GEMINI_API_KEY ? 'set' : 'NOT SET'}`);
  console.log(`  Node.js: ${process.version}`);
  console.log('');

  // Worker Registry (Phase 4)
  try {
    const registry = new WorkerRegistry();
    const summary = await registry.getSummary();
    console.log(`Worker Registry: ${summary.total} nodes`);
    console.log(`  Online: ${summary.online} | Busy: ${summary.busy} | Offline: ${summary.offline}`);
  } catch (err) {
    console.log('Worker Registry: not available');
  }
  console.log('');

  // Performance Metrics (T32)
  try {
    const metrics = getSummaryMetrics();
    console.log('Execution Metrics (T32):');
    console.log(`  Total hops: ${metrics.total_hops}`);
    console.log(`  Success rate: ${metrics.total_hops ? Math.round((metrics.success_count / metrics.total_hops) * 100) : 0}%`);
    console.log(`  Avg latency: ${Math.round(metrics.avg_duration || 0)}ms`);
    console.log(`  Total cost: $${(metrics.total_cost || 0).toFixed(4)}`);
  } catch (err) {
    console.log('Performance Metrics: not available');
  }
  console.log('');

  // Dead-letter queue
  const deadLetterItems = await listDeadLetter(config.dead_letter.path, config.dead_letter.backend);
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
