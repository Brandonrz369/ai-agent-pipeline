import { readFile } from 'node:fs/promises';
import { GeminiOrchestrator } from '../orchestrator/index.js';
import { routeBatch } from '../router/index.js';
import type { TaskBlueprint } from '../types/index.js';

export async function dispatchCommand(tasksFile: string, opts: { dryRun?: boolean; parallel?: boolean }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('Error: GEMINI_API_KEY not set.');
    process.exit(1);
  }

  const raw = await readFile(tasksFile, 'utf-8');
  const tasks: TaskBlueprint[] = JSON.parse(raw);

  console.log(`Loaded ${tasks.length} tasks from ${tasksFile}`);

  // Route tasks
  const routing = routeBatch(tasks);
  console.log('\nRouting decisions:');
  routing.forEach((r) => console.log(`  ${r.task_id}: Tier ${r.tier} — ${r.reason}`));

  if (opts.dryRun) {
    console.log('\n[DRY RUN] No tasks executed.');
    return;
  }

  // Dispatch
  const orchestrator = new GeminiOrchestrator({ geminiApiKey: apiKey });
  const results = await orchestrator.dispatchBatch(tasks, opts.parallel);

  // Summary
  const summary = await orchestrator.summarizeForMobile(results);
  console.log('\n' + summary);
}
