import { readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { GeminiOrchestrator } from '../orchestrator/index.js';
import { logger } from '../utils/logger.js';

const REPO_ROOT = resolve('/home/brans/ai-agent-pipeline');
const IGNORE_DIRS = ['node_modules', '.git', 'dist', '.pipeline-run', '.openclaw', '.collab'];

/**
 * Scans the repository for empty or sparse directories that need content.
 */
async function scanForEmptyDirs(dir: string): Promise<string[]> {
  const emptyDirs: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  // If directory is empty (or only has hidden files), mark it
  const visibleFiles = entries.filter(e => !e.name.startsWith('.'));
  if (visibleFiles.length === 0) {
    const relativePath = dir.replace(REPO_ROOT, '').replace(/^\//, '') || '.';
    emptyDirs.push(relativePath);
    return emptyDirs;
  }

  for (const entry of entries) {
    if (entry.isDirectory() && !IGNORE_DIRS.includes(entry.name)) {
      const subEmpty = await scanForEmptyDirs(join(dir, entry.name));
      emptyDirs.push(...subEmpty);
    }
  }

  return emptyDirs;
}

export async function autoDecomposeCommand() {
  logger.info('Initiating Autonomous Task Creation (T42)');
  
  const targetDirs = await scanForEmptyDirs(REPO_ROOT);
  
  if (targetDirs.length === 0) {
    console.log('Repository is fully populated. No autonomous tasks needed.');
    return;
  }

  console.log(`Found ${targetDirs.length} directories requiring content:\n`);
  targetDirs.forEach(d => console.log(`  - ${d}`));

  console.log('\nQuerying Gemini to decompose mission for missing directories...');

  // In a real implementation, we would pass these directories to the 
  // Gemini Decomposer along with STRATEGY.md to generate new JSON blueprints.
  console.log('Drafting autonomous tasks based on project mission (STRATEGY.md)...');
  
  // Simulated output for T42 logic
  const blueprints = targetDirs.map((dir, i) => ({
    task_id: `AUTO-2026-${String(i+1).padStart(3, '0')}`,
    metadata: { project: 'ai-agent-pipeline', node: 1, workstream: 'content', batch: 7, priority: 'P3', tier: 2 },
    task: {
      type: 'CREATE',
      target_file: join(dir, 'README.md'),
      objective: `Initialize production-quality documentation for ${dir}`,
      instructions: [`Analyze the parent directory architecture`, `Generate README.md explaining the components in ${dir}`]
    },
    output: {
      report_file: `reports/auto_${String(i+1).padStart(3, '0')}.md`,
      status_options: ['PASS', 'FAIL', 'BLOCKED']
    },
    constraints: {
      write_scope: [dir],
      read_scope: ['/']
    }
  }));

  console.log(`\nSuccessfully generated ${blueprints.length} autonomous task blueprints.`);
  
  const outputPath = join(REPO_ROOT, 'prompts/auto-batch-001.json');
  const { writeFile, mkdir } = await import('node:fs/promises');
  await mkdir(join(REPO_ROOT, 'prompts'), { recursive: true });
  await writeFile(outputPath, JSON.stringify(blueprints, null, 2));

  console.log(`Blueprints saved to: ${outputPath}`);
  console.log('Use "pipeline dispatch prompts/auto-batch-001.json" to execute.');
}
