import { AntigravityClient } from '../utils/antigravity-client.js';
import type { TaskBlueprint, PromptMode, Tier } from '../types/index.js';
import { logger } from '../utils/logger.js';

export interface ClassificationResult {
  taskType: 'code' | 'gui' | 'research' | 'simple_tool';
  promptMode: PromptMode;
  tier: Tier;
  confidence: number;
  reasoning: string;
}

// Rule-based fast-path classification
function classifyByRules(task: TaskBlueprint): ClassificationResult | null {
  const objective = task.task.objective.toLowerCase();
  const instructions = task.task.instructions.join(' ').toLowerCase();
  const combined = `${objective} ${instructions}`;

  // GUI tasks → SUPERVISE
  if (/\b(gui|browser|click|navigate|screenshot|install app|wizard)\b/.test(combined)) {
    return {
      taskType: 'gui',
      promptMode: 'SUPERVISE',
      tier: 2,
      confidence: 0.9,
      reasoning: 'GUI keywords detected — using SUPERVISE mode',
    };
  }

  // Research tasks → tier 3
  if (task.task.type === 'RESEARCH' || /\b(research|analyze|investigate|deep dive)\b/.test(combined)) {
    return {
      taskType: 'research',
      promptMode: 'EXECUTE',
      tier: 3,
      confidence: 0.85,
      reasoning: 'Research task — routing to tier 3 for deep analysis',
    };
  }

  // Simple reads/queries → tier 1
  if (task.task.type === 'REVIEW' || /\b(read|list|check|validate|count)\b/.test(combined)) {
    return {
      taskType: 'simple_tool',
      promptMode: 'EXECUTE',
      tier: 1,
      confidence: 0.8,
      reasoning: 'Simple tool/read task — routing to tier 1',
    };
  }

  // Code tasks → tier 2
  if (/\b(create|write|edit|implement|build|code|function|class|module)\b/.test(combined)) {
    return {
      taskType: 'code',
      promptMode: 'EXECUTE',
      tier: 2,
      confidence: 0.8,
      reasoning: 'Code generation task — routing to tier 2',
    };
  }

  return null;
}

export async function classifyTask(
  task: TaskBlueprint,
  geminiApiKey?: string,
): Promise<ClassificationResult> {
  // Try rule-based first
  const ruleResult = classifyByRules(task);
  if (ruleResult && ruleResult.confidence >= 0.8) {
    logger.debug('Task classified by rules', { task_id: task.task_id, ...ruleResult });
    return ruleResult;
  }

  // If we have explicit tier from metadata, use it
  if (task.metadata.tier) {
    return {
      taskType: 'code',
      promptMode: 'EXECUTE',
      tier: task.metadata.tier,
      confidence: 1.0,
      reasoning: `Tier ${task.metadata.tier} specified in task metadata`,
    };
  }

  // Fallback to Gemini classification if API key available
  if (geminiApiKey) {
    try {
      return await classifyWithGemini(task, geminiApiKey);
    } catch (err) {
      logger.warn('Gemini classification failed, using fallback', { error: String(err) });
    }
  }

  // Default fallback
  return {
    taskType: 'code',
    promptMode: 'EXECUTE',
    tier: 2,
    confidence: 0.5,
    reasoning: 'Default classification — tier 2 EXECUTE',
  };
}

async function classifyWithGemini(
  task: TaskBlueprint,
  _apiKey?: string,
): Promise<ClassificationResult> {
  const client = new AntigravityClient('gemini-3.1-pro-high');

  const prompt = `Classify this task. Return JSON only:
{"taskType": "code|gui|research|simple_tool", "promptMode": "EXECUTE|ARCHITECT|SUPERVISE", "tier": 1|2|3, "confidence": 0.0-1.0, "reasoning": "..."}

Task: ${task.task.objective}
Type: ${task.task.type}
Instructions: ${task.task.instructions.slice(0, 3).join('; ')}`;

  const response = await client.generateContent(prompt, 1024);

  const text = response.text;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[0]);
  }

  throw new Error('Could not parse Gemini classification response');
}
