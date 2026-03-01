import { spawn } from 'node:child_process';
import type { PromptMode, ClaudeOutput } from '../types/index.js';
import { getCliFlags } from './modes.js';
import { logger } from '../utils/logger.js';

export interface SessionOptions {
  mode: PromptMode;
  prompt: string;
  sessionId?: string;
  timeoutMs?: number;
  cwd?: string;
}

export interface SessionResult {
  success: boolean;
  output: ClaudeOutput | null;
  rawOutput: string;
  rawError: string;
  exitCode: number | null;
  sessionId?: string;
  durationMs: number;
}

export async function spawnClaudeSession(options: SessionOptions): Promise<SessionResult> {
  const { mode, prompt, sessionId, timeoutMs = 300_000, cwd } = options;
  const flags = getCliFlags(mode);

  const args = ['-p', prompt, ...flags];
  if (sessionId) {
    args.push('--resume', sessionId);
  }

  logger.info('Spawning Claude Code session', {
    mode,
    promptLength: prompt.length,
    sessionId,
    args: args.filter((a) => a !== prompt).join(' '),
  });

  const startTime = Date.now();

  return new Promise<SessionResult>((resolve) => {
    // Remove CLAUDECODE env var to allow nested Claude Code sessions.
    // When running inside a Claude Code session, this var blocks spawning
    // child sessions. The pipeline executor MUST be able to spawn Claude
    // as a subprocess.
    const childEnv = { ...process.env };
    delete childEnv.CLAUDECODE;

    const proc = spawn('claude', args, {
      cwd: cwd || process.cwd(),
      timeout: timeoutMs,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],  // stdin must be 'ignore' — Claude hangs on piped stdin
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on('close', (code) => {
      const durationMs = Date.now() - startTime;

      logger.info('Claude Code session complete', {
        exitCode: code,
        durationMs,
        outputLength: stdout.length,
      });

      let output: ClaudeOutput | null = null;
      let parsedJson: Record<string, unknown> | null = null;
      try {
        parsedJson = JSON.parse(stdout);
        // Claude --output-format json returns { result: string, ... }
        if (parsedJson?.result) {
          try {
            output = JSON.parse(parsedJson.result as string);
          } catch {
            output = {
              task_id: '',
              status: code === 0 ? 'PASS' : 'FAIL',
              summary: parsedJson.result as string,
              affected_files: [],
            };
          }
        } else {
          output = parsedJson as unknown as ClaudeOutput;
          if (output && !output.affected_files) {
            output.affected_files = [];
          }
        }
      } catch {
        output = {
          task_id: '',
          status: code === 0 ? 'PASS' : 'FAIL',
          summary: stdout.trim(),
          affected_files: [],
        };
      }

      if (output) {
        output.duration_ms = durationMs;
      }

      resolve({
        success: code === 0,
        output,
        rawOutput: stdout,
        rawError: stderr,
        exitCode: code,
        sessionId: parsedJson?.session_id as string | undefined,
        durationMs,
      });
    });

    proc.on('error', (err) => {
      const durationMs = Date.now() - startTime;
      logger.error('Claude Code session error', { error: err.message });
      resolve({
        success: false,
        output: null,
        rawOutput: stdout,
        rawError: err.message,
        exitCode: null,
        durationMs,
      });
    });
  });
}
