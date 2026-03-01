/**
 * Legacy Agency Task Store (SQLite Migration)
 *
 * Persistent shared store for agency tasks.
 * Ensures consistency across multiple worker processes.
 */

import { randomUUID } from "node:crypto";
import { getDb } from "../utils/db.js";

export type AgencyTaskStatus = "OPEN" | "IN_PROGRESS" | "DONE" | "BLOCKED";

export interface AgencyTask {
  id: string;
  description: string;
  status: AgencyTaskStatus;
  assigned?: string;
  clientName?: string;
  applicationName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgencyTaskCreateInput {
  description: string;
  status?: AgencyTaskStatus;
  assigned?: string;
  clientName?: string;
  applicationName?: string;
}

export interface ListOptions {
  page?: number;
  limit?: number;
  status?: string;
  assigned?: string;
  q?: string;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export class TaskStore {
  add(input: AgencyTaskCreateInput): AgencyTask {
    const db = getDb();
    const now = new Date().toISOString();
    const task: AgencyTask = {
      id: randomUUID(),
      description: input.description,
      status: input.status ?? "OPEN",
      assigned: input.assigned,
      clientName: input.clientName,
      applicationName: input.applicationName,
      createdAt: now,
      updatedAt: now
    };

    db.prepare(`
      INSERT INTO agency_tasks (id, description, status, assigned, client_name, application_name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      task.id,
      task.description,
      task.status,
      task.assigned || null,
      task.clientName || null,
      task.applicationName || null,
      task.createdAt,
      task.updatedAt
    );

    return task;
  }

  getById(id: string): AgencyTask | null {
    const db = getDb();
    const row = db.prepare('SELECT * FROM agency_tasks WHERE id = ?').get(id) as any;

    if (!row) return null;

    return {
      id: row.id,
      description: row.description,
      status: row.status as AgencyTaskStatus,
      assigned: row.assigned,
      clientName: row.client_name,
      applicationName: row.application_name,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  list(opts: ListOptions = {}): PaginatedResult<AgencyTask> {
    const db = getDb();
    const page = Math.max(1, Number(opts.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(opts.limit) || 20));
    const offset = (page - 1) * limit;

    let query = 'SELECT * FROM agency_tasks WHERE 1=1';
    const params: any[] = [];

    if (opts.status) {
      query += ' AND UPPER(status) = ?';
      params.push(opts.status.toUpperCase());
    }
    if (opts.assigned) {
      query += ' AND UPPER(assigned) = ?';
      params.push(opts.assigned.toUpperCase());
    }
    if (opts.q) {
      query += ' AND LOWER(description) LIKE ?';
      params.push(`%${opts.q.toLowerCase()}%`);
    }

    // Get total for pagination
    const countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as count');
    const total = (db.prepare(countQuery).get(...params) as any).count;

    // Get page data
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    
    const rows = db.prepare(query).all(...params) as any[];
    const data = rows.map(row => ({
      id: row.id,
      description: row.description,
      status: row.status as AgencyTaskStatus,
      assigned: row.assigned,
      clientName: row.client_name,
      applicationName: row.application_name,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));

    const totalPages = Math.max(1, Math.ceil(total / limit));

    return {
      data,
      pagination: { page, limit, total, totalPages }
    };
  }

  clear(): void {
    getDb().prepare('DELETE FROM agency_tasks').run();
  }

  size(): number {
    return (getDb().prepare('SELECT COUNT(*) as count FROM agency_tasks').get() as any).count;
  }
}

let _defaultStore: TaskStore | null = null;
export function getTaskStore(): TaskStore {
  if (!_defaultStore) {
    _defaultStore = new TaskStore();
  }
  return _defaultStore;
}
