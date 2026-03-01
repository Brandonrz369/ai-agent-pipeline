import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { PipelineConfig } from '../types/index.js';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

function resolveEnvVars(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return obj.replace(/\$\{(\w+)\}/g, (_, varName) => process.env[varName] || '');
  }
  if (Array.isArray(obj)) {
    return obj.map(resolveEnvVars);
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = resolveEnvVars(value);
    }
    return result;
  }
  return obj;
}

export async function loadYamlConfig<T = unknown>(relativePath: string): Promise<T> {
  const fullPath = resolve(REPO_ROOT, relativePath);
  const raw = await readFile(fullPath, 'utf-8');
  const parsed = parseYaml(raw);
  return resolveEnvVars(parsed) as T;
}

let _pipelineConfig: PipelineConfig | null = null;

export async function loadPipelineConfig(): Promise<PipelineConfig> {
  if (_pipelineConfig) return _pipelineConfig;

  const raw = await loadYamlConfig<Record<string, unknown>>('config/openclaw-config.yaml');
  _pipelineConfig = {
    orchestrator: raw.orchestrator as PipelineConfig['orchestrator'],
    verifier: raw.verifier as PipelineConfig['verifier'],
    claude_code: raw.claude_code as PipelineConfig['claude_code'],
    anti_loop: raw.anti_loop as PipelineConfig['anti_loop'],
    dead_letter: raw.dead_letter as PipelineConfig['dead_letter'],
  };
  return _pipelineConfig;
}

export interface McpServerConfig {
  description: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  available_to: string[];
  docker_image: string | null;
  approved_digest: string | null;
}

export interface McpRegistryConfig {
  servers: Record<string, McpServerConfig>;
  access_matrix: Record<string, string[]>;
}

let _mcpConfig: McpRegistryConfig | null = null;

export async function loadMcpConfig(): Promise<McpRegistryConfig> {
  if (_mcpConfig) return _mcpConfig;
  _mcpConfig = await loadYamlConfig<McpRegistryConfig>('config/mcp-servers.yaml');
  return _mcpConfig;
}

