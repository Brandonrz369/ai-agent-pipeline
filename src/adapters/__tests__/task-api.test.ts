/**
 * Task API Tests -- T22 (CHARLIE)
 * Tests for GET /api/tasks (list/paginate/filter/search) and GET /api/tasks/:id
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createWebhookServer } from '../../gateway/webhook.js';
import { TaskStore } from '../task-store.js';
import type { AgencyTask, PaginatedResult } from '../task-store.js';

async function httpGet(port: number, path: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch('http://localhost:' + port + path);
  const body = await res.json();
  return { status: res.status, body };
}

describe('Task API -- GET /api/tasks', () => {
  let store: TaskStore;
  let srv: ReturnType<typeof createWebhookServer>;
  let port: number;

  beforeEach(async () => {
    store = new TaskStore();
    port = 9100 + Math.floor(Math.random() * 900);
    srv = createWebhookServer({ port, taskStore: store });
    await srv.start();
  });

  afterEach(async () => {
    await srv.stop();
  });

  // Listing
  it('returns empty result when no tasks exist', async () => {
    const { status, body } = await httpGet(port, '/api/tasks');
    expect(status).toBe(200);
    const r = body as PaginatedResult<AgencyTask>;
    expect(r.data).toEqual([]);
    expect(r.pagination.total).toBe(0);
    expect(r.pagination.page).toBe(1);
    expect(r.pagination.limit).toBe(20);
    expect(r.pagination.totalPages).toBe(1);
  });

  it('returns all tasks', async () => {
    store.add({ description: 'Task A', status: 'OPEN', assigned: 'BRAVO' });
    store.add({ description: 'Task B', status: 'DONE', assigned: 'CHARLIE' });
    const { status, body } = await httpGet(port, '/api/tasks');
    expect(status).toBe(200);
    const r = body as PaginatedResult<AgencyTask>;
    expect(r.data).toHaveLength(2);
    expect(r.pagination.total).toBe(2);
  });

  // Pagination
  describe('pagination', () => {
    beforeEach(() => {
      for (let i = 0; i < 25; i++) {
        store.add({ description: 'Task ' + i, status: 'OPEN' });
      }
    });

    it('defaults to page 1, limit 20', async () => {
      const { body } = await httpGet(port, '/api/tasks');
      const r = body as PaginatedResult<AgencyTask>;
      expect(r.data).toHaveLength(20);
      expect(r.pagination.page).toBe(1);
      expect(r.pagination.limit).toBe(20);
      expect(r.pagination.total).toBe(25);
      expect(r.pagination.totalPages).toBe(2);
    });

    it('returns page 2 with remaining items', async () => {
      const { body } = await httpGet(port, '/api/tasks?page=2&limit=20');
      const r = body as PaginatedResult<AgencyTask>;
      expect(r.data).toHaveLength(5);
      expect(r.pagination.page).toBe(2);
    });

    it('respects custom limit', async () => {
      const { body } = await httpGet(port, '/api/tasks?limit=5');
      const r = body as PaginatedResult<AgencyTask>;
      expect(r.data).toHaveLength(5);
      expect(r.pagination.limit).toBe(5);
      expect(r.pagination.totalPages).toBe(5);
    });

    it('treats page=0 as page 1', async () => {
      const { body } = await httpGet(port, '/api/tasks?page=0');
      const r = body as PaginatedResult<AgencyTask>;
      expect(r.pagination.page).toBe(1);
      expect(r.data).toHaveLength(20);
    });

    it('returns empty data for page beyond last', async () => {
      const { body } = await httpGet(port, '/api/tasks?page=999');
      const r = body as PaginatedResult<AgencyTask>;
      expect(r.data).toHaveLength(0);
      expect(r.pagination.total).toBe(25);
    });
  });

  // Filter by status
  describe('filter by status', () => {
    beforeEach(() => {
      store.add({ description: 'Open task', status: 'OPEN', assigned: 'BRAVO' });
      store.add({ description: 'Done task', status: 'DONE', assigned: 'CHARLIE' });
      store.add({ description: 'Blocked task', status: 'BLOCKED', assigned: 'BRAVO' });
    });

    it('filters by status=DONE', async () => {
      const { body } = await httpGet(port, '/api/tasks?status=DONE');
      const r = body as PaginatedResult<AgencyTask>;
      expect(r.data).toHaveLength(1);
      expect(r.data[0].status).toBe('DONE');
    });

    it('filters by status=OPEN', async () => {
      const { body } = await httpGet(port, '/api/tasks?status=OPEN');
      const r = body as PaginatedResult<AgencyTask>;
      expect(r.data).toHaveLength(1);
      expect(r.data[0].status).toBe('OPEN');
    });

    it('is case-insensitive for status', async () => {
      const { body } = await httpGet(port, '/api/tasks?status=done');
      const r = body as PaginatedResult<AgencyTask>;
      expect(r.data).toHaveLength(1);
      expect(r.data[0].status).toBe('DONE');
    });

    it('returns empty when no tasks match status', async () => {
      const { body } = await httpGet(port, '/api/tasks?status=IN_PROGRESS');
      const r = body as PaginatedResult<AgencyTask>;
      expect(r.data).toHaveLength(0);
      expect(r.pagination.total).toBe(0);
    });
  });

  // Filter by assigned
  describe('filter by assigned agent', () => {
    beforeEach(() => {
      store.add({ description: 'Bravo task 1', assigned: 'BRAVO', status: 'OPEN' });
      store.add({ description: 'Bravo task 2', assigned: 'BRAVO', status: 'IN_PROGRESS' });
      store.add({ description: 'Charlie task', assigned: 'CHARLIE', status: 'DONE' });
      store.add({ description: 'Unassigned task' });
    });

    it('filters by assigned=BRAVO', async () => {
      const { body } = await httpGet(port, '/api/tasks?assigned=BRAVO');
      const r = body as PaginatedResult<AgencyTask>;
      expect(r.data).toHaveLength(2);
      r.data.forEach(t => expect(t.assigned).toBe('BRAVO'));
    });

    it('filters by assigned=CHARLIE', async () => {
      const { body } = await httpGet(port, '/api/tasks?assigned=CHARLIE');
      const r = body as PaginatedResult<AgencyTask>;
      expect(r.data).toHaveLength(1);
      expect(r.data[0].assigned).toBe('CHARLIE');
    });

    it('is case-insensitive for assigned', async () => {
      const { body } = await httpGet(port, '/api/tasks?assigned=bravo');
      const r = body as PaginatedResult<AgencyTask>;
      expect(r.data).toHaveLength(2);
    });

    it('combines status and assigned filters', async () => {
      store.add({ description: 'Bravo done', assigned: 'BRAVO', status: 'DONE' });
      const { body } = await httpGet(port, '/api/tasks?assigned=BRAVO&status=DONE');
      const r = body as PaginatedResult<AgencyTask>;
      expect(r.data).toHaveLength(1);
      expect(r.data[0].description).toBe('Bravo done');
    });
  });

  // Search
  describe('search by keyword (q)', () => {
    beforeEach(() => {
      store.add({ description: 'Process dental records for Acme', status: 'OPEN' });
      store.add({ description: 'Generate quarterly report', status: 'DONE' });
      store.add({ description: 'Enter dental patient data', status: 'OPEN' });
    });

    it('finds tasks matching keyword', async () => {
      const { body } = await httpGet(port, '/api/tasks?q=dental');
      const r = body as PaginatedResult<AgencyTask>;
      expect(r.data).toHaveLength(2);
    });

    it('is case-insensitive for search', async () => {
      const { body } = await httpGet(port, '/api/tasks?q=DENTAL');
      const r = body as PaginatedResult<AgencyTask>;
      expect(r.data).toHaveLength(2);
    });

    it('returns empty when no tasks match', async () => {
      const { body } = await httpGet(port, '/api/tasks?q=nonexistent');
      const r = body as PaginatedResult<AgencyTask>;
      expect(r.data).toHaveLength(0);
    });

    it('supports partial keyword match', async () => {
      const { body } = await httpGet(port, '/api/tasks?q=quart');
      const r = body as PaginatedResult<AgencyTask>;
      expect(r.data).toHaveLength(1);
      expect(r.data[0].description).toContain('quarterly');
    });
  });

  // Single task
  describe('GET /api/tasks/:id', () => {
    it('returns a task by ID', async () => {
      const created = store.add({ description: 'Find me by ID', status: 'OPEN' });
      const { status, body } = await httpGet(port, '/api/tasks/' + created.id);
      expect(status).toBe(200);
      const r = body as { data: AgencyTask };
      expect(r.data.id).toBe(created.id);
      expect(r.data.description).toBe('Find me by ID');
      expect(r.data.status).toBe('OPEN');
    });

    it('returns 404 for unknown ID', async () => {
      const { status, body } = await httpGet(port, '/api/tasks/nonexistent-id-xyz');
      expect(status).toBe(404);
      expect((body as { error: string }).error).toBe('Task not found');
    });

    it('includes all task fields in response', async () => {
      const created = store.add({ description: 'Full task', status: 'IN_PROGRESS', assigned: 'BRAVO', clientName: 'Acme Corp', applicationName: 'Dentrix' });
      const { body } = await httpGet(port, '/api/tasks/' + created.id);
      const r = body as { data: AgencyTask };
      expect(r.data.assigned).toBe('BRAVO');
      expect(r.data.clientName).toBe('Acme Corp');
      expect(r.data.applicationName).toBe('Dentrix');
      expect(r.data.createdAt).toBeDefined();
      expect(r.data.updatedAt).toBeDefined();
    });
  });
});
