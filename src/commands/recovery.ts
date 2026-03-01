import { listDeadLetter, retryFromDeadLetter } from '../anti-loop/dead-letter.js';
import { GeminiOrchestrator } from '../orchestrator/index.js';
import { logger } from '../utils/logger.js';

export async function recoveryCommand(opts: { dryRun?: boolean; limit: string }) {
  const limit = parseInt(opts.limit, 10);
  const items = await listDeadLetter();
  
  // Filter for recoverable items: those with hops remaining or transient failures
  const recoverable = items.filter(item => {
    if (!item.envelope) return false;
    // For now, any item in DLQ is a candidate for manual/automated recovery 
    // but we prioritize those with TTL remaining.
    return item.envelope.hops < item.envelope.ttl_max;
  });

  if (recoverable.length === 0) {
    console.log('No recoverable tasks found in the dead-letter queue.');
    return;
  }

  console.log(`Found ${recoverable.length} recoverable items. Processing top ${limit}...\n`);

  if (opts.dryRun) {
    recoverable.slice(0, limit).forEach(item => {
      console.log(`[DRY RUN] Would recover: ${item.id}`);
      console.log(`  Reason: ${item.reason}`);
      console.log(`  Hops: ${item.envelope.hops}/${item.envelope.ttl_max}\n`);
    });
    return;
  }

  const orchestrator = new GeminiOrchestrator();
  let recoveredCount = 0;

  for (const item of recoverable.slice(0, limit)) {
    try {
      console.log(`Recovering ${item.id}...`);
      
      // 1. Reset envelope
      const newEnvelope = await retryFromDeadLetter(item.id);
      if (!newEnvelope) continue;

      // 2. Re-dispatch (if task data is available)
      if (item.task) {
        const taskWithEnvelope = { ...item.task, envelope: newEnvelope };
        // Dispatch asynchronously
        void orchestrator.dispatchTask(taskWithEnvelope);
        console.log(`  SUCCESS: Re-dispatched ${item.id} to orchestrator.`);
        recoveredCount++;
      } else {
        console.log(`  SKIP: No task blueprint found for ${item.id}.`);
      }
    } catch (err) {
      logger.error('Recovery failed for item', { id: item.id, error: String(err) });
    }
  }

  console.log(`\nRecovery complete. ${recoveredCount} tasks re-dispatched.`);
}
