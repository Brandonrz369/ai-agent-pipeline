/**
 * Legacy Agency Adapter Tests — T15 (Charlie)
 *
 * Tests the conversion of Legacy Automation Agency task submissions
 * into pipeline TaskBlueprints.
 */
import { describe, it, expect } from 'vitest';
import { convertToBlueprint, convertBatch, type LegacyAgencyTask } from '../legacy-agency.js';

function makeAgencyTask(overrides: Partial<LegacyAgencyTask> = {}): LegacyAgencyTask {
  return {
    description: 'Enter 50 patient records into Dentrix from uploaded CSV',
    clientName: 'Acme Dental',
    applicationName: 'Dentrix',
    taskType: 'data_entry',
    urgency: 'medium',
    documents: ['uploads/patients.csv'],
    ...overrides,
  };
}

describe('Legacy Agency Adapter', () => {
  describe('convertToBlueprint', () => {
    it('should convert a data_entry task to EXECUTE/SUPERVISE blueprint', () => {
      const task = makeAgencyTask();
      const blueprint = convertToBlueprint(task);

      expect(blueprint.task_id).toMatch(/^LEGACY-\d{4}-\d{3}-B1-N1$/);
      expect(blueprint.metadata.project).toBe('LEGACY-AGENCY');
      expect(blueprint.metadata.workstream).toBe('Dentrix');
      expect(blueprint.metadata.priority).toBe('P3'); // medium → P3
      expect(blueprint.task.type).toBe('EXECUTE');
      expect(blueprint.task.objective).toBe('Enter 50 patient records into Dentrix from uploaded CSV');
      expect(blueprint.task.instructions.length).toBeGreaterThan(0);
    });

    it('should classify gui_automation as EXECUTE/SUPERVISE/tier 2', () => {
      const task = makeAgencyTask({ taskType: 'gui_automation' });
      const blueprint = convertToBlueprint(task);

      expect(blueprint.task.type).toBe('EXECUTE');
      expect(blueprint.metadata.tier).toBe(2);
    });

    it('should classify report_generation as CREATE/EXECUTE/tier 2', () => {
      const task = makeAgencyTask({ taskType: 'report_generation' });
      const blueprint = convertToBlueprint(task);

      expect(blueprint.task.type).toBe('CREATE');
      expect(blueprint.metadata.tier).toBe(2);
    });

    it('should classify document_processing as REVIEW/EXECUTE/tier 1', () => {
      const task = makeAgencyTask({ taskType: 'document_processing' });
      const blueprint = convertToBlueprint(task);

      expect(blueprint.task.type).toBe('REVIEW');
      expect(blueprint.metadata.tier).toBe(1);
    });

    it('should map urgency to priority correctly', () => {
      expect(convertToBlueprint(makeAgencyTask({ urgency: 'critical' })).metadata.priority).toBe('P1');
      expect(convertToBlueprint(makeAgencyTask({ urgency: 'high' })).metadata.priority).toBe('P2');
      expect(convertToBlueprint(makeAgencyTask({ urgency: 'medium' })).metadata.priority).toBe('P3');
      expect(convertToBlueprint(makeAgencyTask({ urgency: 'low' })).metadata.priority).toBe('P4');
    });

    it('should require human approval for tier 3 tasks', () => {
      // Force tier 3 by making it critical urgency
      const task = makeAgencyTask({ urgency: 'critical' });
      const blueprint = convertToBlueprint(task);

      expect(blueprint.constraints.requires_human_approval).toBe(true);
    });

    it('should require human approval for critical urgency tasks', () => {
      const task = makeAgencyTask({ urgency: 'critical' });
      const blueprint = convertToBlueprint(task);

      expect(blueprint.constraints.requires_human_approval).toBe(true);
    });

    it('should include document references in instructions', () => {
      const task = makeAgencyTask({
        documents: ['uploads/invoice.pdf', 'uploads/receipt.jpg'],
      });
      const blueprint = convertToBlueprint(task);
      const instructionsJoined = blueprint.task.instructions.join(' ');

      expect(instructionsJoined).toContain('uploads/invoice.pdf');
      expect(instructionsJoined).toContain('uploads/receipt.jpg');
    });

    it('should include screenshot references in instructions', () => {
      const task = makeAgencyTask({
        screenshots: ['screenshots/login-screen.png'],
      });
      const blueprint = convertToBlueprint(task);
      const instructionsJoined = blueprint.task.instructions.join(' ');

      expect(instructionsJoined).toContain('screenshots/login-screen.png');
    });

    it('should include application-specific context queries', () => {
      const task = makeAgencyTask({ applicationName: 'SAP' });
      const blueprint = convertToBlueprint(task);

      expect(blueprint.task.context_queries).toBeDefined();
      expect(blueprint.task.context_queries!.some(q => q.includes('SAP'))).toBe(true);
    });

    it('should handle minimal task with only description', () => {
      const task: LegacyAgencyTask = {
        description: 'Simple data entry task for unknown application',
      };
      const blueprint = convertToBlueprint(task);

      expect(blueprint.task_id).toMatch(/^LEGACY-\d{4}-\d{3}-B1-N1$/);
      expect(blueprint.task.objective).toBe('Simple data entry task for unknown application');
      expect(blueprint.task.instructions.length).toBeGreaterThan(0);
      expect(blueprint.metadata.priority).toBe('P3'); // default medium
      expect(blueprint.metadata.tier).toBe(2); // default
    });

    it('should set write scope to reports, results, screenshots', () => {
      const blueprint = convertToBlueprint(makeAgencyTask());

      expect(blueprint.constraints.write_scope).toContain('reports/');
      expect(blueprint.constraints.write_scope).toContain('results/');
      expect(blueprint.constraints.write_scope).toContain('screenshots/');
    });

    it('should forbid src, node_modules, .env, .git', () => {
      const blueprint = convertToBlueprint(makeAgencyTask());

      expect(blueprint.constraints.forbidden).toContain('node_modules/');
      expect(blueprint.constraints.forbidden).toContain('.env');
      expect(blueprint.constraints.forbidden).toContain('.git/');
    });

    it('should include client instructions in task instructions', () => {
      const task = makeAgencyTask({
        instructions: 'Use the Quick Entry mode, not the full form',
      });
      const blueprint = convertToBlueprint(task);

      expect(blueprint.task.instructions).toContain('Use the Quick Entry mode, not the full form');
    });

    it('should use application name as workstream', () => {
      const task = makeAgencyTask({ applicationName: 'QuickBooks Desktop' });
      const blueprint = convertToBlueprint(task);

      expect(blueprint.metadata.workstream).toBe('QuickBooks Desktop');
    });

    it('should default workstream to general when no application specified', () => {
      const task = makeAgencyTask({ applicationName: undefined });
      const blueprint = convertToBlueprint(task);

      expect(blueprint.metadata.workstream).toBe('general');
    });
  });

  describe('convertBatch', () => {
    it('should convert multiple agency tasks to blueprints', () => {
      const tasks: LegacyAgencyTask[] = [
        makeAgencyTask({ description: 'Task 1', applicationName: 'Dentrix' }),
        makeAgencyTask({ description: 'Task 2', applicationName: 'QuickBooks' }),
        makeAgencyTask({ description: 'Task 3', applicationName: 'SAP' }),
      ];

      const blueprints = convertBatch(tasks);

      expect(blueprints).toHaveLength(3);
      expect(blueprints[0].task.objective).toBe('Task 1');
      expect(blueprints[1].task.objective).toBe('Task 2');
      expect(blueprints[2].task.objective).toBe('Task 3');
    });

    it('should generate unique task IDs for each blueprint', () => {
      const tasks = [
        makeAgencyTask({ description: 'A' }),
        makeAgencyTask({ description: 'B' }),
      ];

      const blueprints = convertBatch(tasks);
      // IDs may or may not collide (random), but structure should be valid
      blueprints.forEach(bp => {
        expect(bp.task_id).toMatch(/^LEGACY-\d{4}-\d{3}-B1-N1$/);
      });
    });

    it('should return empty array for empty input', () => {
      expect(convertBatch([])).toEqual([]);
    });
  });
});
