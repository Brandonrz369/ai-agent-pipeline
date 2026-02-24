import { readFile } from 'node:fs/promises';
import { PipelineAdapter, type LegacyAgencyTask } from '../adapters/legacy-agency.js';
import { logger } from '../utils/logger.js';

/**
 * CLI command: pipeline legacy-dispatch <task.json>
 *
 * Reads a Legacy Agency task from a JSON file, converts it to a TaskBlueprint,
 * dispatches through the pipeline, and outputs the result as JSON to stdout.
 *
 * This is the CLI bridge for Legacy Agency server.js → pipeline.
 * Exits with code 0 on success (PASS), 1 on failure (FAIL/DEAD_LETTER).
 */
export async function legacyDispatchCommand(taskFile: string, opts: { dryRun?: boolean }) {
  try {
    const raw = await readFile(taskFile, 'utf-8');
    const legacyTask: LegacyAgencyTask = JSON.parse(raw);

    const pipelineDir = process.cwd();

    const adapter = new PipelineAdapter({
      pipelineDir,
      dryRun: opts.dryRun,
    });

    // Submit and wait for the result (blocking for CLI use)
    const { legacyId, pipelineTaskId } = await adapter.submit(legacyTask);

    // Poll until complete (the dispatch is async internally)
    let status = adapter.getStatus(legacyId);
    while (status && !['completed', 'failed', 'dead_letter'].includes(status.status)) {
      await new Promise((r) => setTimeout(r, 1000));
      status = adapter.getStatus(legacyId);
    }

    if (!status) {
      console.error(JSON.stringify({ error: 'Task tracking lost' }));
      process.exit(1);
    }

    // Output result as JSON
    const output = {
      legacy_id: legacyId,
      pipeline_task_id: pipelineTaskId,
      status: status.status,
      hops: status.result?.totalHops ?? 0,
      final_mode: status.result?.finalMode ?? 'UNKNOWN',
      output: status.result?.output ?? null,
      error: status.error ?? null,
    };

    console.log(JSON.stringify(output, null, 2));
    process.exit(status.status === 'completed' ? 0 : 1);
  } catch (err) {
    console.error(JSON.stringify({ error: String(err) }));
    process.exit(1);
  }
}
