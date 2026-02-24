import { writeFile } from 'node:fs/promises';
import { TaskDecomposer } from '../decomposer/index.js';

export async function decomposeCommand(file: string, opts: { output?: string }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('Error: GEMINI_API_KEY not set.');
    process.exit(1);
  }

  console.log(`Decomposing: ${file}`);
  const decomposer = new TaskDecomposer(apiKey);
  const result = await decomposer.decomposeFromFile(file);

  if (result.validationErrors.length > 0) {
    console.warn('Validation warnings:');
    result.validationErrors.forEach((e) => console.warn(`  - ${e}`));
  }

  console.log(`Generated ${result.tasks.length} task blueprints`);

  const output = opts.output || file.replace(/\.\w+$/, '-tasks.json');
  await writeFile(output, JSON.stringify(result.tasks, null, 2));
  console.log(`Tasks saved to: ${output}`);
}
