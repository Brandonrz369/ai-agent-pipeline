import { execSync } from 'node:child_process';
import { logger } from './logger.js';
import { getTaskStore } from '../adapters/task-store.js';
import { requestApproval } from '../security/hitl.js';

export interface PullRequestOptions {
  taskId: string;
  title: string;
  body: string;
  branch: string;
  base?: string;
}

/**
 * Advanced GitHub Wrapper (T36)
 *
 * Implements high-level automation for PRs, branch management,
 * and integration with the Red Team review cycle.
 */
export class GitHubWrapper {
  /**
   * Create a Pull Request and automatically queue a Red Team review task.
   */
  async createPRWithRedTeam(opts: PullRequestOptions): Promise<{ prUrl: string; reviewTaskId: string }> {
    logger.info('GitHub: Initiating automated PR with Red Team review', { taskId: opts.taskId, branch: opts.branch });

    try {
      // HITL Check: Verify 'git push' permission for this specific instance
      const pushDecision = await requestApproval(`git push origin ${opts.branch}`, opts.taskId, { branch: opts.branch });
      if (pushDecision !== 'APPROVE') {
        throw new Error(`HITL: git push REJECTED for branch ${opts.branch}`);
      }

      // 1. Ensure we are on the correct branch and it's pushed
      execSync(`git push origin ${opts.branch}`, { stdio: 'pipe' });

      // HITL Check: Verify 'gh pr create' permission
      const prDecision = await requestApproval(`gh pr create --title "${opts.title}"`, opts.taskId, { title: opts.title });
      if (prDecision !== 'APPROVE') {
        throw new Error(`HITL: PR creation REJECTED for ${opts.title}`);
      }

      // 2. Create the PR using the 'gh' CLI

      // 3. Queue the Red Team review task in our shared SQLite TaskStore
      const taskStore = getTaskStore();
      const reviewTask = taskStore.add({
        description: `RED TEAM REVIEW: PR #${prUrl.split('/').pop()} for task ${opts.taskId}`,
        status: 'OPEN',
        assigned: 'CHARLIE', // Red Team role usually falls to CHARLIE (Verification)
        clientName: 'Internal',
        applicationName: 'Pipeline'
      });

      logger.info('GitHub: PR created and review task queued', { prUrl, reviewTaskId: reviewTask.id });

      return {
        prUrl,
        reviewTaskId: reviewTask.id
      };
    } catch (err) {
      logger.error('GitHub: Automated PR flow failed', { error: String(err) });
      throw err;
    }
  }

  /**
   * Check PR status and Red Team approval.
   */
  async getReviewStatus(prNumber: string): Promise<{ approved: boolean; issues: string[] }> {
    // This would eventually query the Red Team reports in SQLite or the PR comments
    return { approved: false, issues: ['Integration pending'] };
  }
}
