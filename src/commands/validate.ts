import { validateFile, validateAgainstSchema, type SchemaName } from '../schema/validator.js';

const SCHEMA_MAP: Record<string, SchemaName> = {
  task: 'task-blueprint',
  report: 'report',
  envelope: 'task-envelope',
  routing: 'routing-config',
};

export async function validateCommand(file: string, opts: { schema?: string }) {
  let schemaName: SchemaName;

  if (opts.schema) {
    schemaName = SCHEMA_MAP[opts.schema] || opts.schema as SchemaName;
  } else {
    // Auto-detect from filename
    if (file.includes('task') || file.includes('blueprint')) schemaName = 'task-blueprint';
    else if (file.includes('report')) schemaName = 'report';
    else if (file.includes('envelope')) schemaName = 'task-envelope';
    else if (file.includes('routing')) schemaName = 'routing-config';
    else {
      console.error('Could not auto-detect schema. Use --schema <task|report|envelope|routing>');
      process.exit(1);
    }
  }

  console.log(`Validating ${file} against ${schemaName} schema...`);

  const { readFile } = await import('node:fs/promises');
  const { resolve } = await import('node:path');
  const raw = await readFile(resolve(file), 'utf-8');
  const data = JSON.parse(raw);

  // Handle arrays (e.g., batch task files)
  const items = Array.isArray(data) ? data : [data];
  let allValid = true;

  for (let i = 0; i < items.length; i++) {
    const result = await validateAgainstSchema(items[i], schemaName);
    const label = Array.isArray(data) ? `[${i}] ${items[i].task_id || ''}` : file;

    if (result.valid) {
      console.log(`  ${label}: Valid`);
    } else {
      allValid = false;
      console.error(`  ${label}: INVALID`);
      result.errors.forEach((e) => console.error(`    - ${e}`));
    }
  }

  if (allValid) {
    console.log(`\nAll ${items.length} item(s) valid!`);
  } else {
    console.error('\nSome items had validation errors.');
    process.exit(1);
  }
}
