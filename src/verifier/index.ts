import { AntigravityClient } from '../utils/antigravity-client.js';
import type { TaskBlueprint, ClaudeOutput, VerifierResult } from '../types/index.js';
import { logger } from '../utils/logger.js';

export interface VerificationResult {
  verdict: VerifierResult;
  reasoning: string;
  issues: string[];
}

export class FlashLiteVerifier {
  private client: AntigravityClient;

  constructor(_apiKeyOrClient?: string | AntigravityClient, model = 'gemini-3.1-pro-high') {
    if (_apiKeyOrClient instanceof AntigravityClient) {
      this.client = _apiKeyOrClient;
    } else {
      this.client = new AntigravityClient(model);
    }
  }

  async verify(task: TaskBlueprint, output: ClaudeOutput): Promise<VerificationResult> {
    const prompt = this.buildVerificationPrompt(task, output);

    try {
      const response = await this.client.generateContent(prompt, 2048);
      return this.parseVerificationResponse(response.text);
    } catch (err) {
      logger.error('Verifier API call failed after retries', { error: String(err) });
      // On verifier failure, conservatively return RETRY
      return {
        verdict: 'RETRY',
        reasoning: `Verifier error: ${String(err)}`,
        issues: ['Verification service unavailable after retries'],
      };
    }
  }

  private buildVerificationPrompt(task: TaskBlueprint, output: ClaudeOutput): string {
    return `You are a post-execution verifier. Evaluate whether the Claude Code output successfully addresses the task objective.

TASK:
- ID: ${task.task_id}
- Objective: ${task.task.objective}
- Type: ${task.task.type}
- Expected output: ${task.output.report_file}

CLAUDE OUTPUT:
- Status: ${output.status}
- Summary: ${output.summary}

VERIFICATION CHECKS:
1. Did the output address the objective?
2. Are there obvious errors or missing deliverables?
3. Is the output well-formed?

Return JSON only:
{
  "verdict": "PASS" | "RETRY" | "ESCALATE",
  "reasoning": "one line explanation",
  "issues": ["list of specific issues, empty if PASS"]
}

Rules:
- PASS: Objective clearly met, no obvious issues
- RETRY: Minor issues that another attempt could fix
- ESCALATE: Fundamental problem requiring human review or architectural change`;
  }

  private parseVerificationResponse(text: string): VerificationResult {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          verdict: parsed.verdict || 'RETRY',
          reasoning: parsed.reasoning || 'No reasoning provided',
          issues: parsed.issues || [],
        };
      } catch {
        // Parse failed
      }
    }

    // Heuristic fallback
    const upperText = text.toUpperCase();
    if (upperText.includes('PASS')) {
      return { verdict: 'PASS', reasoning: text.slice(0, 200), issues: [] };
    }
    if (upperText.includes('ESCALATE')) {
      return { verdict: 'ESCALATE', reasoning: text.slice(0, 200), issues: ['Escalation recommended'] };
    }
    return { verdict: 'RETRY', reasoning: text.slice(0, 200), issues: ['Could not parse verifier response'] };
  }
}
