import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

const AjvCtor = Ajv.default || Ajv;
const addFormatsFn = addFormats.default || addFormats;
const ajv = new AjvCtor({ allErrors: true, strict: false });
addFormatsFn(ajv);

const schemaCache = new Map<string, ReturnType<typeof ajv.compile>>();

async function getValidator(schemaName: string) {
  if (schemaCache.has(schemaName)) return schemaCache.get(schemaName)!;

  const schemaPath = resolve(REPO_ROOT, 'schemas', `${schemaName}.schema.json`);
  const raw = await readFile(schemaPath, 'utf-8');
  const schema = JSON.parse(raw);
  const validate = ajv.compile(schema);
  schemaCache.set(schemaName, validate);
  return validate;
}

export type SchemaName = 'task-blueprint' | 'task-envelope' | 'report' | 'routing-config';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export async function validateAgainstSchema(
  data: unknown,
  schemaName: SchemaName,
): Promise<ValidationResult> {
  const validate = await getValidator(schemaName);
  const valid = validate(data) as boolean;

  return {
    valid,
    errors: valid
      ? []
      : (validate.errors || []).map(
          (e: { instancePath?: string; message?: string }) => `${e.instancePath || '/'}: ${e.message}`,
        ),
  };
}

export async function validateFile(
  filePath: string,
  schemaName: SchemaName,
): Promise<ValidationResult> {
  const raw = await readFile(resolve(filePath), 'utf-8');
  const data = JSON.parse(raw);
  return validateAgainstSchema(data, schemaName);
}
