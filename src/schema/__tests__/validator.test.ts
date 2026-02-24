import { describe, it, expect } from 'vitest';
import { validateAgainstSchema } from '../validator.js';

describe('Schema Validator', () => {
  it('should validate a correct task envelope', async () => {
    const envelope = {
      id: 'env-test-1',
      ttl_max: 10,
      hops: 0,
      mode: 'EXECUTE',
    };
    const result = await validateAgainstSchema(envelope, 'task-envelope');
    expect(result.valid).toBe(true);
  });

  it('should reject an invalid task envelope', async () => {
    const envelope = {
      id: 'env-test-2',
      // missing required fields: ttl_max, hops, mode
    };
    const result = await validateAgainstSchema(envelope, 'task-envelope');
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should validate a correct report', async () => {
    const report = {
      task_id: 'PIPE-2026-001-B1-N1',
      node: 1,
      status: 'PASS',
      timestamp: '2026-02-23T12:00:00Z',
      changes_made: [
        { file: 'src/test.ts', description: 'Created test file' },
      ],
    };
    const result = await validateAgainstSchema(report, 'report');
    expect(result.valid).toBe(true);
  });

  it('should validate a GUI automation task blueprint with computer_use', async () => {
    const guiBlueprint = {
      task_id: 'LAA-2026-001-B1-N1',
      metadata: {
        project: 'legacy-automation-agency',
        node: 1,
        workstream: 'gui-automation',
        batch: 1,
        priority: 'P2',
        tier: 3,
      },
      task: {
        type: 'EXECUTE',
        objective: 'Enter 50 patient records from CSV into Dentrix patient registration form',
        instructions: [
          'Take screenshot to verify Dentrix is open',
          'Parse input data from uploads/patients.csv',
          'For each record: navigate to New Patient, fill fields, click Save',
        ],
        mcp_tools_required: ['computer_use', 'filesystem', 'bash', 'gemini-cache'],
        gui_config: {
          target_application: 'Dentrix',
          input_file: 'uploads/patients.csv',
          record_count: 50,
          visual_success_criteria: 'Patient list shows 50 new entries',
        },
      },
      output: {
        report_file: 'reports/laa-001-dentrix.json',
        status_options: ['PASS', 'FAIL', 'PARTIAL', 'BLOCKED'],
      },
      constraints: {
        write_scope: ['results/', 'screenshots/', 'reports/'],
        read_scope: ['uploads/'],
        forbidden: ['src/', '.env'],
        requires_human_approval: true,
      },
    };
    const result = await validateAgainstSchema(guiBlueprint, 'task-blueprint');
    expect(result.valid).toBe(true);
  });

  it('should validate a GUI blueprint with .json report file', async () => {
    const blueprint = {
      task_id: 'LAA-2026-002-B1-N1',
      metadata: {
        project: 'legacy-automation-agency',
        node: 1,
        workstream: 'data-entry',
        batch: 1,
        priority: 'P1',
        tier: 2,
      },
      task: {
        type: 'EXECUTE',
        objective: 'Extract invoice data from uploaded PDF into QuickBooks',
        instructions: ['Open QuickBooks', 'Enter invoice data from PDF'],
      },
      output: {
        report_file: 'reports/laa-002-quickbooks.json',
        status_options: ['PASS', 'FAIL'],
      },
      constraints: {},
    };
    const result = await validateAgainstSchema(blueprint, 'task-blueprint');
    expect(result.valid).toBe(true);
  });

  it('should reject report with BLOCKED status and no blocked_on', async () => {
    const report = {
      task_id: 'PIPE-2026-001-B1-N1',
      node: 1,
      status: 'BLOCKED',
      timestamp: '2026-02-23T12:00:00Z',
      changes_made: [],
      // missing blocked_on (required when status=BLOCKED)
    };
    const result = await validateAgainstSchema(report, 'report');
    expect(result.valid).toBe(false);
  });
});
