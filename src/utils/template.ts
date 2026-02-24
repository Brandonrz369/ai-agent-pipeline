import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

export async function loadTemplate(
  templatePath: string,
  variables: Record<string, string> = {},
): Promise<string> {
  const fullPath = resolve(REPO_ROOT, templatePath);
  let content = await readFile(fullPath, 'utf-8');

  for (const [key, value] of Object.entries(variables)) {
    content = content.replaceAll(`{${key}}`, value);
  }

  return content;
}

export function substituteVars(
  template: string,
  variables: Record<string, string>,
): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replaceAll(`{${key}}`, value);
  }
  return result;
}
