import { logger } from '../utils/logger.js';
import { logAuditEntry } from '../audit/index.js';
import { loadMcpConfig } from '../config/loader.js';

export type Permission = 'read' | 'write' | 'execute' | 'approve' | 'use_tool';

export interface RBACRule {
  node: number | 'orchestrator' | 'redteam' | 'supervisor';
  resource: string;  // glob pattern
  permissions: Permission[];
}

// Default RBAC matrix from security/rbac-config.md
const DEFAULT_RULES: RBACRule[] = [
  // Orchestrator (node 0)
  { node: 0, resource: '*', permissions: ['read'] },
  { node: 0, resource: 'prompts/*', permissions: ['read', 'write'] },
  { node: 0, resource: 'reports/*', permissions: ['read'] },

  // Workers (nodes 1-4) — scoped to own workstream
  { node: 1, resource: 'docs/*', permissions: ['read', 'write'] },
  { node: 2, resource: 'schemas/*', permissions: ['read', 'write'] },
  { node: 3, resource: 'templates/*', permissions: ['read', 'write'] },
  { node: 4, resource: 'security/*', permissions: ['read', 'write'] },

  // All workers can write their own reports
  { node: 1, resource: 'reports/n1_*', permissions: ['write'] },
  { node: 2, resource: 'reports/n2_*', permissions: ['write'] },
  { node: 3, resource: 'reports/n3_*', permissions: ['write'] },
  { node: 4, resource: 'reports/n4_*', permissions: ['write'] },

  // Red team (node 5) — read all, write only redteam reports
  { node: 5, resource: '*', permissions: ['read'] },
  { node: 5, resource: 'reports/redteam_*', permissions: ['write'] },

  // Supervisor (node 6+) — computer use
  { node: 6, resource: '*', permissions: ['read', 'write'] },
];

function matchesGlob(resource: string, pattern: string): boolean {
  if (pattern === '*') return true;
  const regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
  return regex.test(resource);
}

export function checkPermission(
  node: number,
  resource: string,
  permission: Permission,
  customRules?: RBACRule[],
): boolean {
  const rules = customRules || DEFAULT_RULES;

  for (const rule of rules) {
    const nodeMatch =
      rule.node === node ||
      (rule.node === 'orchestrator' && node === 0) ||
      (rule.node === 'redteam' && node === 5) ||
      (rule.node === 'supervisor' && node >= 6);

    if (nodeMatch && matchesGlob(resource, rule.resource) && rule.permissions.includes(permission)) {
      return true;
    }
  }

  return false;
}

export async function enforcePermission(
  node: number,
  resource: string,
  permission: Permission,
  taskId?: string,
): Promise<void> {
  const allowed = checkPermission(node, resource, permission);

  if (!allowed) {
    await logAuditEntry('RBAC_VIOLATION', {
      node,
      resource,
      permission,
      allowed: false,
    }, taskId, node);

    logger.warn('RBAC violation', { node, resource, permission });
    throw new Error(`RBAC: Node ${node} does not have ${permission} permission on ${resource}`);
  }

  logger.debug('RBAC check passed', { node, resource, permission });
}

/**
 * Verify that a specific node/role is allowed to use an MCP tool.
 */
export async function enforceToolPermission(
  node: number,
  toolName: string,
  taskId?: string
): Promise<void> {
  const mcpConfig = await loadMcpConfig();
  
  // Determine role based on node ID (Sync with DEFAULT_RULES)
  let role: keyof typeof mcpConfig.access_matrix = 'worker';
  if (node === 0) role = 'orchestrator';
  else if (node === 5) role = 'redteam';
  else if (node >= 6) role = 'supervisor';

  const allowedTools = mcpConfig.access_matrix[role] || [];
  const isAllowed = allowedTools.includes(toolName);

  if (!isAllowed) {
    await logAuditEntry('RBAC_TOOL_VIOLATION', {
      node,
      role,
      toolName,
      allowed: false,
    }, taskId, node);

    logger.warn('RBAC tool violation', { node, role, toolName });
    throw new Error(`RBAC: Role '${role}' (Node ${node}) is not authorized to use tool '${toolName}'`);
  }

  logger.debug('RBAC tool check passed', { role, toolName });
}
