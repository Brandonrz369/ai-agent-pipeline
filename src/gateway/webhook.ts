import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { logger } from '../utils/logger.js';
import { logAuditEntry } from '../audit/index.js';
import { resolveApproval, listPendingApprovals } from '../security/discord-hitl.js';
import { getHealthReport } from '../health/index.js';
import { getMonitor } from '../monitoring/index.js';
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
        void getMonitor().recordError("gateway","webhook_error","n8n-callback parse error: "+String(err));
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
        void getMonitor().recordError("gateway","webhook_error","hitl-response error: "+String(err));
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
        void getMonitor().recordError('gateway','webhook_error','dispatch error: '+String(err));
        sendJson(res, 400, { error: String(err) });
      }
      return;
    }

    // GET /api/escalation -- JSON escalation report
    if (url.pathname === '/api/escalation' && method === 'GET') {
      try {
        const { getEscalationReport } = await import('../escalation/index.js');
        const report = await getEscalationReport();
        sendJson(res, 200, report);
      } catch (err) {
        sendJson(res, 500, { error: String(err) });
      }
      return;
    }

    // GET /dashboard -- HTML escalation dashboard (auto-refresh 30s)
    if (url.pathname === '/dashboard' && method === 'GET') {
      try {
        const { getEscalationReport, formatEscalationAge } = await import('../escalation/index.js');
        const report = await getEscalationReport();
        const rows = report.items.map((item: any) => {
          const sev = item.severity;
          const clr = sev==='CRITICAL'?'#e53e3e':sev==='HIGH'?'#dd6b20':sev==='MEDIUM'?'#3182ce':'#718096';
          const age = item.ageMs > 0 ? formatEscalationAge(item.ageMs) : 'pending';
          return '<tr><td><b style="color:'+clr+'">'+sev+'</b></td><td>'+item.type+'</td><td>'+item.id.slice(0,32)+'</td><td>'+String(item.description||'-').slice(0,60)+'</td><td>'+item.reason.slice(0,60)+'</td><td>'+age+'</td></tr>';
        }).join('');
        const sc=report.criticalCount>0?'#e53e3e':report.totalCount>0?'#dd6b20':'#38a169';
        const st=report.criticalCount>0?(report.criticalCount+' CRITICAL'):report.totalCount>0?(report.totalCount+' items'):'All clear';
        const html='<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta http-equiv="refresh" content="30"><title>Escalation Dashboard</title><style>body{font-family:system-ui;background:#1a202c;color:#e2e8f0;padding:20px}h1{color:#90cdf4}table{width:100%;border-collapse:collapse;background:#2d3748;border-radius:8px;overflow:hidden}th{background:#4a5568;padding:10px;text-align:left;font-size:12px;text-transform:uppercase;color:#a0aec0}td{padding:10px;border-bottom:1px solid #4a5568;font-size:13px}tr:hover td{background:#374151}.badge{display:inline-block;padding:4px 12px;border-radius:4px;font-weight:bold;background:'+sc+';color:white}</style></head><body><h1>Pipeline Escalation Dashboard</h1><p style="color:#718096;font-size:13px">Generated: '+report.generatedAt+' | Refreshes every 30s</p><p>Status: <span class="badge">'+st+'</span></p>'+(report.totalCount===0?'<p style="color:#38a169;font-size:18px">&#10003; No escalated or stuck tasks</p>':'<table><thead><tr><th>Severity</th><th>Type</th><th>ID</th><th>Description</th><th>Reason</th><th>Age</th></tr></thead><tbody>'+rows+'</tbody></table>')+'</body></html>';
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      } catch (err) {
        sendJson(res, 500, { error: String(err) });
      }
      return;
    }

    // GET /metrics -- monitor stats
    if (url.pathname === '/metrics' && method === 'GET') {
      sendJson(res, 200, getMonitor().getStats());
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
