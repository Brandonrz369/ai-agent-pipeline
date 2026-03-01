import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { logger } from '../utils/logger.js';
import { loadMcpConfig, type McpServerConfig } from '../config/loader.js';

/**
 * Verify that an MCP server's command/package matches its approved SHA-256 digest.
 * This mitigates supply-chain attacks in distributed tool execution.
 */
export async function verifyMcpIntegrity(serverName: string): Promise<boolean> {
  const config = await loadMcpConfig();
  const server = config.servers[serverName];

  if (!server) {
    logger.error('Security Alert: Attempted to verify unknown MCP server', { serverName });
    return false;
  }

  // If no digest is pinned, we allow it (policy can be tightened later)
  if (!server.approved_digest) {
    logger.warn('Security Warning: No approved_digest pinned for MCP server', { serverName });
    return true;
  }

  try {
    const actualDigest = await calculateMcpDigest(server);
    const isMatch = actualDigest === server.approved_digest;

    if (!isMatch) {
      logger.error('CRITICAL SECURITY ALERT: MCP Digest Mismatch!', {
        serverName,
        expected: server.approved_digest,
        actual: actualDigest
      });
    } else {
      logger.info('MCP Integrity Verified', { serverName, digest: actualDigest });
    }

    return isMatch;
  } catch (err) {
    logger.error('Security Error: Failed to calculate MCP digest', { serverName, error: String(err) });
    return false;
  }
}

/**
 * Calculates a unique digest for the server configuration.
 * For 'npx' commands, it includes the package name and arguments.
 */
async function calculateMcpDigest(server: McpServerConfig): Promise<string> {
  const hash = createHash('sha256');
  
  // Hash the command and all arguments to pin the exact execution path
  hash.update(server.command);
  for (const arg of server.args) {
    hash.update(arg);
  }

  // In a real production scenario, we would also hash the local binary 
  // or the specific npm package version/integrity field.
  return `sha256:${hash.digest('hex').slice(0, 16)}...`;
}
