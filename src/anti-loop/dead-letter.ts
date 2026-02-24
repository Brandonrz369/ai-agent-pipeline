import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import type { TaskEnvelope, TaskBlueprint } from '../types/index.js';
import { logger } from '../utils/logger.js';

const DEFAULT_DEAD_LETTER_PATH = join(homedir(), '.openclaw', 'dead-letter');

export interface DeadLetterItem {
  id: string;
  envelope: TaskEnvelope;
  task?: TaskBlueprint;
  reason: string;
  sent_at: string;
  file_path: string;
}

function getDeadLetterDir(customPath?: string): string {
  const dir = customPath?.replace('~', homedir()) || DEFAULT_DEAD_LETTER_PATH;
  return resolve(dir);
}

export async function sendToDeadLetter(
  envelope: TaskEnvelope,
  reason: string,
  task?: TaskBlueprint,
  customPath?: string,
): Promise<DeadLetterItem> {
  const dir = getDeadLetterDir(customPath);
  await mkdir(dir, { recursive: true });

  const item: DeadLetterItem = {
    id: envelope.id,
    envelope,
    task,
    reason,
    sent_at: new Date().toISOString(),
    file_path: '',
  };

  const fileName = `${envelope.id}-${Date.now()}.json`;
  item.file_path = join(dir, fileName);

  await writeFile(item.file_path, JSON.stringify(item, null, 2));
  logger.warn('Task sent to dead-letter queue', {
    id: envelope.id,
    reason,
    path: item.file_path,
  });

  return item;
}

export async function listDeadLetter(customPath?: string): Promise<DeadLetterItem[]> {
  const dir = getDeadLetterDir(customPath);
  try {
    const files = await readdir(dir);
    const items: DeadLetterItem[] = [];

    for (const file of files.filter((f) => f.endsWith('.json'))) {
      const raw = await readFile(join(dir, file), 'utf-8');
      items.push(JSON.parse(raw));
    }

    return items.sort((a, b) => b.sent_at.localeCompare(a.sent_at));
  } catch {
    return [];
  }
}

export async function inspectDeadLetter(
  id: string,
  customPath?: string,
): Promise<DeadLetterItem | null> {
  const items = await listDeadLetter(customPath);
  return items.find((i) => i.id === id) || null;
}

export async function retryFromDeadLetter(
  id: string,
  customPath?: string,
): Promise<TaskEnvelope | null> {
  const item = await inspectDeadLetter(id, customPath);
  if (!item) return null;

  // Reset envelope for retry
  const retried: TaskEnvelope = {
    ...item.envelope,
    hops: 0,
    consecutive_failures: 0,
    consecutive_successes: 0,
    state_hashes: [],
    escalated: false,
    mode: 'EXECUTE',
    created_at: new Date().toISOString(),
    last_hop_at: undefined,
  };

  logger.info('Retrying dead-letter item', { id, originalReason: item.reason });
  return retried;
}
