import { WorkerNode, NodeStatus, RegistryUpdate } from '../types/index.js';
import { logger } from '../utils/logger.js';

export class WorkerRegistry {
  private nodes: Map<string, WorkerNode> = new Map();

  registerNode(node: WorkerNode): void {
    this.nodes.set(node.id, {
      ...node,
      last_seen: new Date().toISOString(),
    });
    logger.info('Node registered', { nodeId: node.id, hostname: node.hostname });
  }

  updateNode(update: RegistryUpdate): boolean {
    const node = this.nodes.get(update.node_id);
    if (!node) return false;

    node.status = update.status;
    if (update.load_average !== undefined) {
      node.load_average = update.load_average;
    }
    node.last_seen = new Date().toISOString();
    return true;
  }

  getOnlineNodes(): WorkerNode[] {
    return Array.from(this.nodes.values()).filter(n => n.status === 'ONLINE');
  }

  getNode(id: string): WorkerNode | undefined {
    return this.nodes.get(id);
  }

  removeNode(id: string): boolean {
    return this.nodes.delete(id);
  }

  getSummary() {
    const all = Array.from(this.nodes.values());
    return {
      total: all.length,
      online: all.filter(n => n.status === 'ONLINE').length,
      busy: all.filter(n => n.status === 'BUSY').length,
      offline: all.filter(n => n.status === 'OFFLINE').length,
    };
  }
}
