import Database from 'better-sqlite3';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync } from 'node:fs';
import { logger } from './logger.js';

const DB_DIR = join(homedir(), '.openclaw');
const DB_PATH = resolve(join(DB_DIR, 'pipeline.db'));

let dbInstance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!dbInstance) {
    mkdirSync(DB_DIR, { recursive: true });
    dbInstance = new Database(DB_PATH);
    dbInstance.pragma('journal_mode = WAL');
    
    logger.info('Shared SQLite database initialized', { path: DB_PATH });
    
    // Initialize schema
    initSchema(dbInstance);
  }
  return dbInstance;
}

function initSchema(db: Database.Database) {
  // Worker Registry
  db.prepare(`
    CREATE TABLE IF NOT EXISTS worker_nodes (
      id TEXT PRIMARY KEY,
      hostname TEXT,
      ip TEXT,
      port INTEGER,
      status TEXT,
      capabilities TEXT,
      last_seen TEXT,
      load_average REAL
    )
  `).run();

  // Dead-Letter Queue
  db.prepare(`
    CREATE TABLE IF NOT EXISTS dead_letter_items (
      id TEXT PRIMARY KEY,
      envelope TEXT,
      task TEXT,
      reason TEXT,
      sent_at TEXT,
      file_path TEXT
    )
  `).run();

  // Agency Tasks (Legacy Migration)
  db.prepare(`
    CREATE TABLE IF NOT EXISTS agency_tasks (
      id TEXT PRIMARY KEY,
      description TEXT,
      status TEXT,
      assigned TEXT,
      client_name TEXT,
      application_name TEXT,
      created_at TEXT,
      updated_at TEXT
    )
  `).run();

  // Advanced Telemetry (T32)
  db.prepare(`
    CREATE TABLE IF NOT EXISTS performance_metrics (
      id TEXT PRIMARY KEY,
      task_id TEXT,
      trace_id TEXT,
      node_id TEXT,
      hop INTEGER,
      mode TEXT,
      duration_ms INTEGER,
      cost_usd REAL,
      status TEXT,
      timestamp TEXT
    )
  `).run();
}
