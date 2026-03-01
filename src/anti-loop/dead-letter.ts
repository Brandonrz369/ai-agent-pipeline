import type { TaskEnvelope, TaskBlueprint } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { createDeadLetterStore, type DeadLetterItem } from './dead-letter-store.js';

export async function sendToDeadLetter(
  envelope: TaskEnvelope,
  reason: string,
  task?: TaskBlueprint,
  customPath?: string,
): Promise<DeadLetterItem> {
  const store = createDeadLetterStore(undefined, customPath);
  
  const item = await store.save({
    id: envelope.id,
    envelope,
    task,
    reason,
  });

  logger.warn('Task sent to dead-letter queue', {
    id: envelope.id,
    reason,
    path: item.file_path,
  });

  return item;
}

export async function listDeadLetter(customPath?: string): Promise<DeadLetterItem[]> {
  const store = createDeadLetterStore(undefined, customPath);
  return store.list();
}

export async function inspectDeadLetter(
  id: string,
  customPath?: string,
): Promise<DeadLetterItem | null> {
  const store = createDeadLetterStore(undefined, customPath);
  return store.get(id);
}

export async function deleteDeadLetter(
  id: string,
  customPath?: string,
): Promise<boolean> {
  const store = createDeadLetterStore(undefined, customPath);
  return store.delete(id);
}

export async function retryFromDeadLetter(
  id: string,
  customPath?: string,
): Promise<TaskEnvelope | null> {
  const store = createDeadLetterStore(undefined, customPath);
  const item = await store.get(id);
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

export type { DeadLetterItem } from './dead-letter-store.js';
