import { WorkerNode, NodeStatus, RegistryUpdate } from '../types/index.js';
import { logger } from '../utils/logger.js';

export class WorkerRegistry {
  async registerNode(node: WorkerNode): Promise<void> {
    const { getDb } = await import('../utils/db.js');
    const db = getDb();
    const lastSeen = new Date().toISOString();

    db.prepare(`
      INSERT OR REPLACE INTO worker_nodes (id, hostname, ip, port, status, capabilities, last_seen, load_average)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      node.id,
      node.hostname,
      node.ip,
      node.port,
      node.status,
      JSON.stringify(node.capabilities),
      lastSeen,
      node.load_average
    );

    logger.info('Node registered in shared registry', { nodeId: node.id, hostname: node.hostname });
  }

  async updateNode(update: RegistryUpdate): Promise<boolean> {
    const { getDb } = await import('../utils/db.js');
    const db = getDb();
    const lastSeen = new Date().toISOString();

    const result = db.prepare(`
      UPDATE worker_nodes 
      SET status = ?, load_average = COALESCE(?, load_average), last_seen = ?
      WHERE id = ?
    `).run(update.status, update.load_average ?? null, lastSeen, update.node_id);

    return result.changes > 0;
  }

  async getOnlineNodes(): Promise<WorkerNode[]> {
    const { getDb } = await import('../utils/db.js');
    const db = getDb();
    const rows = db.prepare("SELECT * FROM worker_nodes WHERE status = 'ONLINE'").all() as any[];

    return rows.map(row => ({
      id: row.id,
      hostname: row.hostname,
      ip: row.ip,
      port: row.port,
      status: row.status as NodeStatus,
      capabilities: JSON.parse(row.capabilities),
      last_seen: row.last_seen,
      load_average: row.load_average
    }));
  }

  async getNode(id: string): Promise<WorkerNode | undefined> {
    const { getDb } = await import('../utils/db.js');
    const db = getDb();
    const row = db.prepare('SELECT * FROM worker_nodes WHERE id = ?').get(id) as any;

    if (!row) return undefined;

    return {
      id: row.id,
      hostname: row.hostname,
      ip: row.ip,
      port: row.port,
      status: row.status as NodeStatus,
      capabilities: JSON.parse(row.capabilities),
      last_seen: row.last_seen,
      load_average: row.load_average
    };
  }

  async removeNode(id: string): Promise<boolean> {
    const { getDb } = await import('../utils/db.js');
    const db = getDb();
    const result = db.prepare('DELETE FROM worker_nodes WHERE id = ?').run(id);
    return result.changes > 0;
  }

  async getSummary() {
    const { getDb } = await import('../utils/db.js');
    const db = getDb();
    const rows = db.prepare('SELECT status, count(*) as count FROM worker_nodes GROUP BY status').all() as any[];
    
    const summary = { total: 0, online: 0, busy: 0, offline: 0 };
    for (const row of rows) {
      const s = row.status.toLowerCase() as keyof typeof summary;
      if (s in summary) (summary as any)[s] = row.count;
      summary.total += row.count;
    }
    return summary;
  }
}
