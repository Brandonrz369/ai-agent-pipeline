import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { AntigravityClient } from '../utils/antigravity-client.js';
import { TaskDecomposer } from '../decomposer/index.js';
import { GeminiOrchestrator } from '../orchestrator/index.js';
import { routeBatch } from '../router/index.js';
import type { TaskBlueprint, PromptMode } from '../types/index.js';

interface RunOptions {
  ttl?: string;
  mode?: string;
  dryRun?: boolean;
}

/**
 * Build a synthetic task blueprint from a prompt for dry-run mode.
 * Bypasses Gemini research + decomposition when the API is unavailable.
 */
function buildDryRunTask(prompt: string, ttl: number): TaskBlueprint {
  const taskId = `DRY-${Date.now()}-B1-N1`;
  return {
    task_id: taskId,
    metadata: {
      project: 'pipeline-e2e',
      node: 1,
      workstream: 'e2e-test',
      batch: 1,
      priority: 'P2',
      tier: 2,
    },
    task: {
      type: 'CREATE',
      objective: prompt,
      instructions: [
        prompt,
        'Verify the result is correct',
        'Return JSON with status PASS or FAIL',
      ],
      dependencies: [],
      mcp_tools_required: ['filesystem', 'bash'],
      context_queries: [],
    },
    output: {
      report_file: `reports/${taskId}.md`,
      status_options: ['PASS', 'FAIL', 'PARTIAL', 'BLOCKED'],
    },
    constraints: {
      write_scope: ['.'],
      read_scope: ['*'],
      forbidden: ['node_modules/', '.env'],
    },
  };
}

export async function runCommand(prompt: string, opts: RunOptions) {
  const isDryRun = opts.dryRun || false;
  const ttl = parseInt(opts.ttl || '10', 10);

  console.log('=== AI Agent Pipeline: Full Run ===');
  console.log(`Prompt: ${prompt}`);
  console.log(`TTL: ${ttl}, Initial mode: ${opts.mode || 'EXECUTE'}`);
  if (isDryRun) console.log('Mode: DRY RUN (skipping Gemini, using synthetic task)');
  console.log('');

  const artifactDir = join(process.cwd(), '.pipeline-run');
  await mkdir(artifactDir, { recursive: true });

  let tasks: TaskBlueprint[];

  if (isDryRun) {
    // Dry-run: build a single synthetic task directly from the prompt
    console.log('Phase 1-2: [DRY RUN] Building synthetic task from prompt...');
    tasks = [buildDryRunTask(prompt, ttl)];
    console.log(`  Created 1 synthetic task: ${tasks[0].task_id}`);
    await writeFile(join(artifactDir, 'research.md'), `[DRY RUN] Prompt: ${prompt}`);
  } else {
    // Phase 1: Research via Gemini 3.1 Pro (through Antigravity proxy)
    console.log('Phase 1: Deep Research via Gemini 3.1 Pro...');
    const client = new AntigravityClient('gemini-3.1-pro-high');
    const researchResponse = await client.generateContent(
      `Research and create a detailed technical specification for: ${prompt}\n\nInclude implementation steps, file structure, and success criteria.`,
      8192,
    );

    const research = researchResponse.text;
    console.log(`  Research complete: ${research.length} chars`);
    await writeFile(join(artifactDir, 'research.md'), research);

    // Phase 2: Decompose
    console.log('Phase 2: Task Decomposition...');
    const decomposer = new TaskDecomposer();
    const decomposition = await decomposer.decomposeFromResearch(research);
    console.log(`  Decomposed into ${decomposition.tasks.length} tasks`);

    if (decomposition.tasks.length === 0) {
      console.error('No tasks generated. Research output may have been insufficient.');
      process.exit(1);
    }

    tasks = decomposition.tasks;
  }

  await writeFile(join(artifactDir, 'tasks.json'), JSON.stringify(tasks, null, 2));

  // Phase 3: Route
  console.log('Phase 3: Routing...');
  const routing = routeBatch(tasks);
  routing.forEach((r) => console.log(`  ${r.task_id}: Tier ${r.tier}`));

  // Phase 4: Dispatch
  console.log('Phase 4: Dispatching through completion loop...');
  const orchestrator = new GeminiOrchestrator({
    dryRun: isDryRun,
  });
  const results = await orchestrator.dispatchBatch(tasks, !isDryRun);

  // Summary
  const summary = await orchestrator.summarizeForMobile(results);
  console.log('\n=== Results ===');
  console.log(summary);

  await writeFile(join(artifactDir, 'results.json'), JSON.stringify(results, null, 2));
  console.log(`\nArtifacts saved to: ${artifactDir}`);
}
