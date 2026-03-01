import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import type { TaskEnvelope, TaskBlueprint, DeadLetterBackend } from '../types/index.js';
import { logger } from '../utils/logger.js';

export interface DeadLetterItem {
  id: string;
  envelope: TaskEnvelope;
  task?: TaskBlueprint;
  reason: string;
  sent_at: string;
  file_path?: string;
}

export interface IDeadLetterStore {
  save(item: Omit<DeadLetterItem, 'sent_at'>): Promise<DeadLetterItem>;
  list(): Promise<DeadLetterItem[]>;
  get(id: string): Promise<DeadLetterItem | null>;
  delete(id: string): Promise<boolean>;
}

export class LocalFileDeadLetterStore implements IDeadLetterStore {
  private dir: string;

  constructor(path?: string) {
    const baseDir = path?.replace('~', homedir()) || join(homedir(), '.openclaw', 'dead-letter');
    this.dir = resolve(baseDir);
  }

  async save(item: Omit<DeadLetterItem, 'sent_at'>): Promise<DeadLetterItem> {
    await mkdir(this.dir, { recursive: true });
    
    const fullItem: DeadLetterItem = {
      ...item,
      sent_at: new Date().toISOString(),
    };

    const fileName = `${item.id}-${Date.now()}.json`;
    const filePath = join(this.dir, fileName);
    fullItem.file_path = filePath;

    await writeFile(filePath, JSON.stringify(fullItem, null, 2));
    return fullItem;
  }

  async list(): Promise<DeadLetterItem[]> {
    try {
      const files = await readdir(this.dir);
      const items: DeadLetterItem[] = [];

      for (const file of files.filter((f) => f.endsWith('.json'))) {
        const raw = await readFile(join(this.dir, file), 'utf-8');
        items.push(JSON.parse(raw));
      }

      return items.sort((a, b) => b.sent_at.localeCompare(a.sent_at));
    } catch {
      return [];
    }
  }

  async get(id: string): Promise<DeadLetterItem | null> {
    const items = await this.list();
    return items.find((i) => i.id === id) || null;
  }

  async delete(id: string): Promise<boolean> {
    // Basic implementation for local file deletion could be added here
    return false;
  }
}

export function createDeadLetterStore(config?: DeadLetterBackend, fallbackPath?: string): IDeadLetterStore {
  if (!config || config.type === 'LOCAL_FILE') {
    return new LocalFileDeadLetterStore(fallbackPath);
  }
  
  // Placeholder for Redis/Postgres (to be implemented by BRAVO in T30)
  logger.warn('Requested distributed DLQ backend not yet implemented, falling back to LOCAL_FILE', { type: config.type });
  return new LocalFileDeadLetterStore(fallbackPath);
}
