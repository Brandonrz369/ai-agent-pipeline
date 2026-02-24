/**
 * Brain Context MCP Store Tests — Charlie (proactive hardening)
 *
 * Tests the brain damage prevention module: store/retrieve/delete/list/stats
 * with mocked AntigravityClient and filesystem.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fs/promises BEFORE importing the module under test
vi.mock('node:fs/promises', () => {
  const readFile = vi.fn();
  const writeFile = vi.fn();
  const mkdir = vi.fn();
  return { readFile, writeFile, mkdir };
});

// Mock AntigravityClient (replaced @google/genai in the refactor)
vi.mock('../../../utils/antigravity-client.js', () => ({
  AntigravityClient: vi.fn().mockImplementation(() => ({
    generateContent: vi.fn().mockResolvedValue({
      text: 'Compressed: Key facts preserved. Files at src/. Decision: use TypeScript.',
    }),
  })),
}));

// Mock logger
vi.mock('../../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock retry to avoid retry delays in tests
vi.mock('../../../utils/retry.js', () => ({
  withRetry: vi.fn((fn: () => Promise<unknown>) => fn()),
}));

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { storeContext, getSummary, listContextKeys, deleteContext, getStoreStats } from '../index.js';

const mockReadFile = vi.mocked(readFile);
const mockWriteFile = vi.mocked(writeFile);
const mockMkdir = vi.mocked(mkdir);

describe('Brain Context Store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
  });

  describe('storeContext', () => {
    it('should compress content via AntigravityClient and store it', async () => {
      // Empty store initially
      mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));

      const entry = await storeContext('task-001-session-1-research', 'A very long research document with lots of information about TypeScript patterns, file paths at src/main.ts, decisions to use vitest for testing, and other important facts that need to be preserved across context windows.');

      expect(entry.key).toBe('task-001-session-1-research');
      expect(entry.summary).toContain('Compressed');
      expect(entry.original_tokens).toBeGreaterThan(0);
      expect(entry.compressed_tokens).toBeGreaterThan(0);
      expect(entry.compressed_tokens).toBeLessThan(entry.original_tokens);
      expect(entry.stored_at).toBeDefined();

      // Should have written to the store file
      expect(mockWriteFile).toHaveBeenCalledOnce();
      const writtenData = JSON.parse(mockWriteFile.mock.calls[0][1] as string);
      expect(writtenData.entries['task-001-session-1-research']).toBeDefined();
      expect(writtenData.total_entries).toBe(1);
    });

    it('should overwrite existing entry with same key', async () => {
      const existingStore = {
        entries: {
          'task-001-session-1-research': {
            key: 'task-001-session-1-research',
            summary: 'Old summary',
            original_tokens: 100,
            compressed_tokens: 25,
            stored_at: '2026-02-23T00:00:00.000Z',
          },
        },
        total_entries: 1,
        last_updated: '2026-02-23T00:00:00.000Z',
      };
      mockReadFile.mockResolvedValueOnce(JSON.stringify(existingStore));

      const entry = await storeContext('task-001-session-1-research', 'Updated content');

      expect(entry.summary).not.toBe('Old summary');
      const writtenData = JSON.parse(mockWriteFile.mock.calls[0][1] as string);
      expect(writtenData.total_entries).toBe(1); // Still 1, not 2
    });

    it('should create store directory if missing', async () => {
      mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));

      await storeContext('key-1', 'content');

      expect(mockMkdir).toHaveBeenCalledWith(
        expect.stringContaining('.openclaw'),
        { recursive: true },
      );
    });
  });

  describe('getSummary', () => {
    it('should return summary for existing key', async () => {
      const store = {
        entries: {
          'task-002-session-1-plan': {
            key: 'task-002-session-1-plan',
            summary: 'Plan: implement auth with JWT, files at src/auth/',
            original_tokens: 500,
            compressed_tokens: 50,
            stored_at: '2026-02-23T12:00:00.000Z',
          },
        },
        total_entries: 1,
        last_updated: '2026-02-23T12:00:00.000Z',
      };
      mockReadFile.mockResolvedValueOnce(JSON.stringify(store));

      const summary = await getSummary('task-002-session-1-plan');
      expect(summary).toBe('Plan: implement auth with JWT, files at src/auth/');
    });

    it('should return null for non-existent key', async () => {
      mockReadFile.mockResolvedValueOnce(JSON.stringify({
        entries: {},
        total_entries: 0,
        last_updated: '2026-02-23T00:00:00.000Z',
      }));

      const summary = await getSummary('non-existent-key');
      expect(summary).toBeNull();
    });

    it('should return null when store file does not exist', async () => {
      mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));

      const summary = await getSummary('any-key');
      expect(summary).toBeNull();
    });
  });

  describe('listContextKeys', () => {
    it('should return all stored keys', async () => {
      const store = {
        entries: {
          'key-a': { key: 'key-a', summary: 'a', original_tokens: 10, compressed_tokens: 5, stored_at: '' },
          'key-b': { key: 'key-b', summary: 'b', original_tokens: 20, compressed_tokens: 8, stored_at: '' },
          'key-c': { key: 'key-c', summary: 'c', original_tokens: 30, compressed_tokens: 12, stored_at: '' },
        },
        total_entries: 3,
        last_updated: '',
      };
      mockReadFile.mockResolvedValueOnce(JSON.stringify(store));

      const keys = await listContextKeys();
      expect(keys).toEqual(['key-a', 'key-b', 'key-c']);
    });

    it('should return empty array when store is empty', async () => {
      mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));

      const keys = await listContextKeys();
      expect(keys).toEqual([]);
    });
  });

  describe('deleteContext', () => {
    it('should delete existing entry and return true', async () => {
      const store = {
        entries: {
          'to-delete': { key: 'to-delete', summary: 'x', original_tokens: 10, compressed_tokens: 5, stored_at: '' },
          'to-keep': { key: 'to-keep', summary: 'y', original_tokens: 20, compressed_tokens: 8, stored_at: '' },
        },
        total_entries: 2,
        last_updated: '',
      };
      mockReadFile.mockResolvedValueOnce(JSON.stringify(store));

      const deleted = await deleteContext('to-delete');
      expect(deleted).toBe(true);

      const writtenData = JSON.parse(mockWriteFile.mock.calls[0][1] as string);
      expect(writtenData.entries['to-delete']).toBeUndefined();
      expect(writtenData.entries['to-keep']).toBeDefined();
      expect(writtenData.total_entries).toBe(1);
    });

    it('should return false for non-existent key', async () => {
      mockReadFile.mockResolvedValueOnce(JSON.stringify({
        entries: {},
        total_entries: 0,
        last_updated: '',
      }));

      const deleted = await deleteContext('ghost-key');
      expect(deleted).toBe(false);
      expect(mockWriteFile).not.toHaveBeenCalled();
    });
  });

  describe('getStoreStats', () => {
    it('should return aggregate stats across all entries', async () => {
      const store = {
        entries: {
          'entry-1': { key: 'entry-1', summary: 'a', original_tokens: 1000, compressed_tokens: 200, stored_at: '' },
          'entry-2': { key: 'entry-2', summary: 'b', original_tokens: 2000, compressed_tokens: 300, stored_at: '' },
          'entry-3': { key: 'entry-3', summary: 'c', original_tokens: 500, compressed_tokens: 100, stored_at: '' },
        },
        total_entries: 3,
        last_updated: '2026-02-24T04:00:00.000Z',
      };
      mockReadFile.mockResolvedValueOnce(JSON.stringify(store));

      const stats = await getStoreStats();
      expect(stats.totalEntries).toBe(3);
      expect(stats.totalOriginalTokens).toBe(3500);
      expect(stats.totalCompressedTokens).toBe(600);
      expect(stats.lastUpdated).toBe('2026-02-24T04:00:00.000Z');
    });

    it('should return zeros when store is empty', async () => {
      mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));

      const stats = await getStoreStats();
      expect(stats.totalEntries).toBe(0);
      expect(stats.totalOriginalTokens).toBe(0);
      expect(stats.totalCompressedTokens).toBe(0);
    });
  });
});
