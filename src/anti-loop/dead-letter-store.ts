import { Redis } from 'ioredis';
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

export class RedisDeadLetterStore implements IDeadLetterStore {
  private redis: Redis;
  private keyPrefix: string;

  constructor(connectionString?: string, keyPrefix: string = 'dlq:') {
    this.redis = new Redis(connectionString || 'redis://localhost:6379');
    this.keyPrefix = keyPrefix;
  }

  async save(item: Omit<DeadLetterItem, 'sent_at'>): Promise<DeadLetterItem> {
    const fullItem: DeadLetterItem = {
      ...item,
      sent_at: new Date().toISOString(),
    };
    
    const key = `${this.keyPrefix}${item.id}`;
    await this.redis.set(key, JSON.stringify(fullItem));
    return fullItem;
  }

  async list(): Promise<DeadLetterItem[]> {
    const keys = await this.redis.keys(`${this.keyPrefix}*`);
    if (keys.length === 0) return [];
    
    const values = await this.redis.mget(...keys);
    const items: DeadLetterItem[] = values
      .filter((v): v is string => v !== null)
      .map(v => JSON.parse(v));
      
    return items.sort((a, b) => b.sent_at.localeCompare(a.sent_at));
  }

  async get(id: string): Promise<DeadLetterItem | null> {
    const data = await this.redis.get(`${this.keyPrefix}${id}`);
    return data ? JSON.parse(data) : null;
  }

  async delete(id: string): Promise<boolean> {
    const deleted = await this.redis.del(`${this.keyPrefix}${id}`);
    return deleted > 0;
  }
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
  if (config?.type === 'REDIS') {
    return new RedisDeadLetterStore(config.connection_string, config.table_or_key_prefix);
  }
  
  if (!config || config.type === 'LOCAL_FILE') {
    return new LocalFileDeadLetterStore(fallbackPath);
  }
  
  // Placeholder for Postgres
  logger.warn('Requested distributed DLQ backend not yet implemented, falling back to LOCAL_FILE', { type: config.type });
  return new LocalFileDeadLetterStore(fallbackPath);
}
