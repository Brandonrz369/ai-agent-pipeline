import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

export function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export async function hashFile(filePath: string): Promise<string> {
  const content = await readFile(resolve(filePath));
  return sha256(content);
}

export async function hashFiles(filePaths: string[]): Promise<string> {
  const hashes: string[] = [];
  for (const fp of filePaths.sort()) {
    try {
      const s = await stat(fp);
      if (s.isFile()) {
        hashes.push(await hashFile(fp));
      }
    } catch {
      // File doesn't exist — hash empty string for consistency
      hashes.push(sha256(''));
    }
  }
  return sha256(hashes.join(':'));
}
