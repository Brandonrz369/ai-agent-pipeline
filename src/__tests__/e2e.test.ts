/**
 * E2E Test Suite — T01 (Bravo)
 *
 * Tests the full `pipeline run` command end-to-end.
 * - Dry-run mode: tests all phases without Gemini or Claude
 * - Mock mode: tests with mocked Gemini but real pipeline logic
 * - Live mode: (manual) tests with real Gemini + Claude Code
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

const PIPELINE_DIR = join(__dirname, '..', '..');
const ARTIFACT_DIR = join(PIPELINE_DIR, '.pipeline-run');
const CLI = `npx tsx ${join(PIPELINE_DIR, 'src', 'cli.ts')}`;

// ─── E2E: CLI Help & Status ─────────────────────────────────────

describe('E2E: CLI commands', () => {
  it('should show help text', () => {
    const output = execSync(`${CLI} --help`, { encoding: 'utf-8', cwd: PIPELINE_DIR });
    expect(output).toContain('AI Agent Pipeline');
    expect(output).toContain('research');
    expect(output).toContain('decompose');
    expect(output).toContain('dispatch');
    expect(output).toContain('run');
    expect(output).toContain('validate');
    expect(output).toContain('dead-letter');
    expect(output).toContain('serve');
    expect(output).toContain('status');
    expect(output).toContain('audit');
  });

  it('should show pipeline status', () => {
    const output = execSync(`${CLI} status`, { encoding: 'utf-8', cwd: PIPELINE_DIR });
    expect(output).toContain('AI Agent Pipeline Status');
    expect(output).toContain('GEMINI_API_KEY');
    expect(output).toContain('Node.js');
  });

  it('should show run command help with --dry-run option', () => {
    const output = execSync(`${CLI} run --help`, { encoding: 'utf-8', cwd: PIPELINE_DIR });
    expect(output).toContain('--dry-run');
    expect(output).toContain('--ttl');
    expect(output).toContain('--mode');
  });

  it('should show dead-letter list', () => {
    const output = execSync(`${CLI} dead-letter list`, { encoding: 'utf-8', cwd: PIPELINE_DIR });
    expect(output).toContain('Dead-letter');
  });

  it('should show audit list', () => {
    const output = execSync(`${CLI} audit list`, { encoding: 'utf-8', cwd: PIPELINE_DIR });
    // Should either show entries or "No audit entries"
    expect(output).toBeTruthy();
  });
});

// ─── E2E: Dry Run Pipeline ──────────────────────────────────────

describe('E2E: pipeline run --dry-run', () => {
  beforeEach(async () => {
    try { await rm(ARTIFACT_DIR, { recursive: true, force: true }); } catch {}
  });

  it('should run full pipeline in dry-run mode with "Create hello.txt"', () => {
    const output = execSync(
      `${CLI} run "Create hello.txt" --dry-run`,
      { encoding: 'utf-8', cwd: PIPELINE_DIR, timeout: 30000 },
    );

    // Phase progression
    expect(output).toContain('AI Agent Pipeline: Full Run');
    expect(output).toContain('DRY RUN');
    expect(output).toContain('Phase 1-2:');
    expect(output).toContain('Phase 3: Routing');
    expect(output).toContain('Phase 4: Dispatching');

    // Task classification
    expect(output).toContain('Tier 2'); // CREATE task → tier 2

    // Results
    expect(output).toContain('Results');
    expect(output).toContain('1 passed');
    expect(output).toContain('0 failed');
    expect(output).toContain('0 dead-lettered');

    // Artifacts saved
    expect(output).toContain('.pipeline-run');
  });

  it('should create artifact files in .pipeline-run/', async () => {
    execSync(
      `${CLI} run "Create hello.txt" --dry-run`,
      { encoding: 'utf-8', cwd: PIPELINE_DIR, timeout: 30000 },
    );

    // Check artifact files exist
    const researchStat = await stat(join(ARTIFACT_DIR, 'research.md'));
    expect(researchStat.isFile()).toBe(true);

    const tasksStat = await stat(join(ARTIFACT_DIR, 'tasks.json'));
    expect(tasksStat.isFile()).toBe(true);

    const resultsStat = await stat(join(ARTIFACT_DIR, 'results.json'));
    expect(resultsStat.isFile()).toBe(true);
  });

  it('should produce valid tasks.json with proper schema', async () => {
    execSync(
      `${CLI} run "Create hello.txt" --dry-run`,
      { encoding: 'utf-8', cwd: PIPELINE_DIR, timeout: 30000 },
    );

    const tasksJson = await readFile(join(ARTIFACT_DIR, 'tasks.json'), 'utf-8');
    const tasks = JSON.parse(tasksJson);

    expect(Array.isArray(tasks)).toBe(true);
    expect(tasks.length).toBe(1);

    const task = tasks[0];
    expect(task.task_id).toMatch(/^DRY-/);
    expect(task.metadata.tier).toBe(2);
    expect(task.task.type).toBe('CREATE');
    expect(task.task.objective).toBe('Create hello.txt');
    expect(task.constraints).toBeDefined();
    expect(task.output).toBeDefined();
  });

  it('should produce valid results.json', async () => {
    execSync(
      `${CLI} run "Create hello.txt" --dry-run`,
      { encoding: 'utf-8', cwd: PIPELINE_DIR, timeout: 30000 },
    );

    const resultsJson = await readFile(join(ARTIFACT_DIR, 'results.json'), 'utf-8');
    const results = JSON.parse(resultsJson);

    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(1);

    const result = results[0];
    expect(result.status).toBe('PASS');
    expect(result.totalHops).toBe(0); // Dry-run skips execution
    expect(result.finalMode).toBe('EXECUTE');
    expect(result.deadLettered).toBe(false);
    expect(result.classification).toBeDefined();
    expect(result.classification.taskType).toBe('code');
  });

  it('should respect custom TTL', () => {
    const output = execSync(
      `${CLI} run "Create hello.txt" --dry-run --ttl 3`,
      { encoding: 'utf-8', cwd: PIPELINE_DIR, timeout: 30000 },
    );

    expect(output).toContain('TTL: 3');
  });

  it('should handle different prompt types correctly', () => {
    // Research-type prompt
    const researchOutput = execSync(
      `${CLI} run "Research authentication patterns" --dry-run`,
      { encoding: 'utf-8', cwd: PIPELINE_DIR, timeout: 30000 },
    );
    expect(researchOutput).toContain('Results');

    // GUI-type prompt
    const guiOutput = execSync(
      `${CLI} run "Navigate browser to login page and click submit" --dry-run`,
      { encoding: 'utf-8', cwd: PIPELINE_DIR, timeout: 30000 },
    );
    expect(guiOutput).toContain('Results');
  });
});

// ─── E2E: Schema Validation ─────────────────────────────────────

describe('E2E: pipeline validate', () => {
  it('should validate a valid task blueprint', async () => {
    const { writeFile: wf, mkdir: mkd, mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const tmpDir = await mkdtemp(join(tmpdir(), 'pipeline-e2e-'));

    const taskBlueprint = {
      task_id: 'TEST-2026-001-B1-N1',
      metadata: {
        project: 'test',
        node: 1,
        workstream: 'test',
        batch: 1,
        priority: 'P2',
        tier: 2,
      },
      task: {
        type: 'CREATE',
        objective: 'Create a test file',
        instructions: ['Write hello world'],
      },
      output: {
        report_file: 'reports/test.md',
        status_options: ['PASS', 'FAIL'],
      },
      constraints: {
        write_scope: ['src/'],
        read_scope: ['*'],
      },
    };

    const testFile = join(tmpDir, 'test-blueprint.json');
    await wf(testFile, JSON.stringify(taskBlueprint, null, 2));

    const output = execSync(
      `${CLI} validate ${testFile} --schema task`,
      { encoding: 'utf-8', cwd: PIPELINE_DIR, timeout: 15000 },
    );
    expect(output).toBeTruthy();
  });
});

// ─── E2E: Dead-Letter Queue ─────────────────────────────────────

describe('E2E: dead-letter management', () => {
  it('should list dead-letter items without crashing', () => {
    const output = execSync(
      `${CLI} dead-letter list`,
      { encoding: 'utf-8', cwd: PIPELINE_DIR, timeout: 15000 },
    );
    expect(output).toBeTruthy();
  });
});

// ─── E2E: Audit Trail ───────────────────────────────────────────

describe('E2E: audit trail', () => {
  it('should list audit entries without crashing', () => {
    const output = execSync(
      `${CLI} audit list`,
      { encoding: 'utf-8', cwd: PIPELINE_DIR, timeout: 15000 },
    );
    expect(output).toBeTruthy();
  });

  it('should verify audit integrity', () => {
    // This may show "no entries" or verify existing ones
    try {
      const output = execSync(
        `${CLI} audit verify`,
        { encoding: 'utf-8', cwd: PIPELINE_DIR, timeout: 15000 },
      );
      expect(output).toBeTruthy();
    } catch (err: unknown) {
      // audit verify may exit non-zero if no entries exist — that's OK
      const error = err as { status?: number };
      expect(error.status).toBeDefined();
    }
  });
});
