import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { AntigravityClient } from '../../utils/antigravity-client.js';
import type { BrainContextStore, BrainContextEntry } from '../../types/index.js';
import { logger } from '../../utils/logger.js';

const STORE_PATH = join(homedir(), '.openclaw', 'brain-context-store.json');

async function ensureStoreDir() {
  await mkdir(join(homedir(), '.openclaw'), { recursive: true });
}

async function loadStore(): Promise<BrainContextStore> {
  try {
    const raw = await readFile(STORE_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { entries: {}, total_entries: 0, last_updated: new Date().toISOString() };
  }
}

async function saveStore(store: BrainContextStore) {
  await ensureStoreDir();
  store.last_updated = new Date().toISOString();
  store.total_entries = Object.keys(store.entries).length;
  await writeFile(STORE_PATH, JSON.stringify(store, null, 2));
}

export async function storeContext(
  key: string,
  content: string,
  _apiKeyUnused?: string,
  model = 'gemini-3.1-pro-high',
): Promise<BrainContextEntry> {
  const client = new AntigravityClient(model);

  // Compress via Gemini 3.1 Pro
  const response = await client.generateContent(
    `Compress the following content into a concise summary of ~200 tokens. Preserve all key facts, decisions, file paths, and action items. Remove filler and redundancy.\n\nCONTENT TO COMPRESS:\n${content}\n\nReturn ONLY the compressed summary, nothing else.`,
    1024,
  );

  const summary = response.text?.trim() ?? content.slice(0, 500);

  const entry: BrainContextEntry = {
    key,
    summary,
    original_tokens: Math.ceil(content.length / 4), // rough token estimate
    compressed_tokens: Math.ceil(summary.length / 4),
    stored_at: new Date().toISOString(),
  };

  const store = await loadStore();
  store.entries[key] = entry;
  await saveStore(store);

  logger.info('Brain context stored', {
    key,
    originalTokens: entry.original_tokens,
    compressedTokens: entry.compressed_tokens,
    ratio: `${((1 - entry.compressed_tokens / entry.original_tokens) * 100).toFixed(0)}% reduction`,
  });

  return entry;
}

export async function getSummary(key: string): Promise<string | null> {
  const store = await loadStore();
  const entry = store.entries[key];
  return entry?.summary ?? null;
}

export async function listContextKeys(): Promise<string[]> {
  const store = await loadStore();
  return Object.keys(store.entries);
}

export async function deleteContext(key: string): Promise<boolean> {
  const store = await loadStore();
  if (store.entries[key]) {
    delete store.entries[key];
    await saveStore(store);
    return true;
  }
  return false;
}

export async function getStoreStats(): Promise<{
  totalEntries: number;
  totalOriginalTokens: number;
  totalCompressedTokens: number;
  lastUpdated: string;
}> {
  const store = await loadStore();
  let totalOriginal = 0;
  let totalCompressed = 0;

  for (const entry of Object.values(store.entries)) {
    totalOriginal += entry.original_tokens;
    totalCompressed += entry.compressed_tokens;
  }

  return {
    totalEntries: store.total_entries,
    totalOriginalTokens: totalOriginal,
    totalCompressedTokens: totalCompressed,
    lastUpdated: store.last_updated,
  };
}
