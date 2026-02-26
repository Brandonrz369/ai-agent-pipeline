import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { logger } from '../utils/logger.js';
import { logAuditEntry } from '../audit/index.js';
import { resolveApproval, listPendingApprovals } from '../security/discord-hitl.js';
import { getHealthReport } from '../health/index.js';
import { getTaskStore, type TaskStore } from '../adapters/task-store.js';

export interface WebhookConfig {
  port: number;
  onTaskReceived?: (task: unknown) => Promise<void>;
  onHITLResponse?: (gateId: string, decision: string) => Promise<void>;
  taskStore?: TaskStore;
}

function parseBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, statusCode: number, data: unknown) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

export function createWebhookServer(config: WebhookConfig) {
  const store = config.taskStore ?? getTaskStore();

  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://localhost:${config.port}`);
    const method = req.method || 'GET';

    // Enhanced health check — returns full health report
    if (url.pathname === '/health' && method === 'GET') {
      try {
        const report = await getHealthReport();
        const statusCode = report.status === 'ok' ? 200 : 503;
        sendJson(res, statusCode, report);
      } catch (err) {
        sendJson(res, 503, { status: 'down', error: String(err), timestamp: new Date().toISOString() });
      }
      return;
    }

    // GET /api/tasks — list tasks with pagination, filter, search
    if (url.pathname === '/api/tasks' && method === 'GET') {
      const result = store.list({
        page: url.searchParams.get('page') ? Number(url.searchParams.get('page')) : undefined,
        limit: url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : undefined,
        status: url.searchParams.get('status') ?? undefined,
        assigned: url.searchParams.get('assigned') ?? undefined,
        q: url.searchParams.get('q') ?? undefined,
      });
      sendJson(res, 200, result);
      return;
    }

    // GET /api/tasks/:id — single task by ID
    const _pp = url.pathname.split('/').filter(Boolean);
    if (_pp[0] === 'api' && _pp[1] === 'tasks' && _pp[2] && _pp.length === 3 && method === 'GET') {
      const task = store.getById(_pp[2]);
      if (!task) {
        sendJson(res, 404, { error: 'Task not found' });
      } else {
        sendJson(res, 200, { data: task });
      }
      return;
    }

    // N8n callback — receive completed tasks
    if (url.pathname === '/webhook/n8n-callback' && method === 'POST') {
      try {
        const body = JSON.parse(await parseBody(req));
        await logAuditEntry('N8N_CALLBACK', { body });
        if (config.onTaskReceived) {
          await config.onTaskReceived(body);
        }
        sendJson(res, 200, { received: true });
      } catch (err) {
        sendJson(res, 400, { error: String(err) });
      }
      return;
    }

    // HITL response — resolves pending Discord approval requests
    if (url.pathname === '/webhook/hitl-response' && method === 'POST') {
      try {
        const body = JSON.parse(await parseBody(req));
        const { gate_id, decision, task_id } = body;
        await logAuditEntry('HITL_WEBHOOK_RESPONSE', { gate_id, decision, task_id });
        const resolved = resolveApproval(gate_id, decision, task_id);
        if (config.onHITLResponse) {
          await config.onHITLResponse(gate_id, decision);
        }
        sendJson(res, 200, { received: true, gate_id, decision, resolved });
      } catch (err) {
        sendJson(res, 400, { error: String(err) });
      }
      return;
    }

    // List pending HITL approvals
    if (url.pathname === '/webhook/hitl-pending' && method === 'GET') {
      sendJson(res, 200, { pending: listPendingApprovals() });
      return;
    }

    // Pipeline dispatch trigger
    if (url.pathname === '/webhook/dispatch' && method === 'POST') {
      try {
        const body = JSON.parse(await parseBody(req));
        await logAuditEntry('WEBHOOK_DISPATCH', { task_count: Array.isArray(body) ? body.length : 1 });
        if (config.onTaskReceived) {
          await config.onTaskReceived(body);
        }
        sendJson(res, 200, { dispatched: true });
      } catch (err) {
        sendJson(res, 400, { error: String(err) });
      }
      return;
    }

    // 404
    sendJson(res, 404, { error: 'Not found' });
  });

  return {
    start() {
      return new Promise<void>((resolve) => {
        server.listen(config.port, () => {
          logger.info('Webhook server started', { port: config.port });
          resolve();
        });
      });
    },
    stop() {
      return new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
    server,
  };
}
