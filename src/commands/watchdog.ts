import { WorkerRegistry } from '../orchestrator/registry.js';
import { recoveryCommand } from './recovery.js';
import { logger } from '../utils/logger.js';

/**
 * Self-Healing Watchdog (T43)
 *
 * Monitors the Registry for stale/OFFLINE nodes and automatically 
 * triggers the recovery logic to re-dispatch their orphaned tasks.
 */
export async function watchdogCommand(opts: { interval: string; once?: boolean }) {
  const registry = new WorkerRegistry();
  const intervalMs = parseInt(opts.interval, 10) * 1000;

  console.log('=== AI Agent Pipeline: Self-Healing Watchdog ===');
  console.log(`Monitoring cluster health every ${opts.interval}s...\n`);

  const runCycle = async () => {
    try {
      logger.info('Watchdog: Starting health cycle');

      // 1. Reap stale nodes (marks silent nodes as OFFLINE)
      const reapedCount = await registry.reapStaleNodes();
      
      if (reapedCount > 0) {
        console.log(`[WATCHDOG] Detected ${reapedCount} silent nodes. Triggering recovery...`);
        
        // 2. Trigger automated recovery for the dead nodes' tasks
        // We use a limit of 10 to prevent overwhelming the orchestrator
        await recoveryCommand({ limit: '10' });
      } else {
        logger.debug('Watchdog: No health failures detected');
      }

    } catch (err) {
      logger.error('Watchdog cycle failed', { error: String(err) });
    }
  };

  // Initial run
  await runCycle();

  if (opts.once) {
    return;
  }

  // Periodic loop
  setInterval(runCycle, intervalMs);
}
