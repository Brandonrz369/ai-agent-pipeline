import { createHmac, randomBytes } from 'node:crypto';
import { appendFile, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { AuditEntry } from '../types/index.js';
import { logger } from '../utils/logger.js';

const AUDIT_DIR = join(homedir(), '.openclaw', 'audit');
const HMAC_SECRET = process.env.AUDIT_HMAC_SECRET || randomBytes(32).toString('hex');

function computeHmac(data: string): string {
  return createHmac('sha256', HMAC_SECRET).update(data).digest('hex');
}

async function ensureAuditDir() {
  await mkdir(AUDIT_DIR, { recursive: true });
}

function getAuditFilePath(): string {
  const date = new Date().toISOString().split('T')[0];
  return join(AUDIT_DIR, `audit-${date}.jsonl`);
}

export async function logAuditEntry(
  action: string,
  details: Record<string, unknown>,
  taskId?: string,
  node?: number,
): Promise<AuditEntry> {
  await ensureAuditDir();

  const entry: Omit<AuditEntry, 'hmac'> = {
    timestamp: new Date().toISOString(),
    action,
    task_id: taskId,
    node,
    details,
  };

  const dataString = JSON.stringify(entry);
  const hmac = computeHmac(dataString);

  const fullEntry: AuditEntry = { ...entry, hmac };

  await appendFile(getAuditFilePath(), JSON.stringify(fullEntry) + '\n');

  logger.debug('Audit entry logged', { action, task_id: taskId });
  return fullEntry;
}

export async function verifyAuditEntry(entry: AuditEntry): Promise<boolean> {
  const { hmac, ...rest } = entry;
  const expected = computeHmac(JSON.stringify(rest));
  return hmac === expected;
}

export async function readAuditLog(date?: string): Promise<AuditEntry[]> {
  const dateStr = date || new Date().toISOString().split('T')[0];
  const filePath = join(AUDIT_DIR, `audit-${dateStr}.jsonl`);

  try {
    const raw = await readFile(filePath, 'utf-8');
    return raw
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

export async function verifyAuditLog(date?: string): Promise<{
  total: number;
  valid: number;
  tampered: number;
}> {
  const entries = await readAuditLog(date);
  let valid = 0;
  let tampered = 0;

  for (const entry of entries) {
    if (await verifyAuditEntry(entry)) {
      valid++;
    } else {
      tampered++;
    }
  }

  return { total: entries.length, valid, tampered };
}
