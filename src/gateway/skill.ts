import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { logger } from '../utils/logger.js';

// OpenClaw skills live in ~/.openclaw/skills/<skill-name>/SKILL.md
const SKILL_DIR = join(homedir(), '.openclaw', 'skills', 'ai-pipeline');
const SKILL_SOURCE = join(__dirname, '..', '..', 'openclaw-skill', 'SKILL.md');

/**
 * Install the pipeline as an OpenClaw skill.
 * Copies the SKILL.md from the repo's openclaw-skill/ directory
 * to ~/.openclaw/skills/ai-pipeline/SKILL.md so OpenClaw discovers it.
 */
export async function installSkill(): Promise<string> {
  await mkdir(SKILL_DIR, { recursive: true });
  const skillPath = join(SKILL_DIR, 'SKILL.md');

  // Try to copy from repo source first, fall back to inline content
  try {
    const source = await readFile(SKILL_SOURCE, 'utf-8');
    await writeFile(skillPath, source);
  } catch {
    // Source file not found — write inline fallback
    await writeFile(skillPath, SKILL_MD_FALLBACK);
  }

  logger.info('Pipeline skill installed', { path: skillPath });
  return skillPath;
}

const SKILL_MD_FALLBACK = `---
name: ai-pipeline
description: "Run the AI Agent Pipeline — Gemini orchestrator + Claude Code executor with anti-loop safeguards."
metadata:
  {
    "openclaw": { "emoji": "🔄", "requires": { "anyBins": ["claude", "tsx", "node"] } },
  }
---

# AI Agent Pipeline

Two-tier autonomous agent pipeline: Gemini classifies/routes, Claude Code executes/thinks.

## Commands
- \`pipeline run <prompt>\` — Full pipeline: research → decompose → dispatch
- \`pipeline research <prompt>\` — Phase 1 deep research
- \`pipeline decompose <file>\` — Phase 2 task decomposition
- \`pipeline dispatch <tasks.json>\` — Run tasks through completion loop
- \`pipeline validate <file>\` — Schema validation
- \`pipeline dead-letter list|retry|inspect\` — Dead-letter queue
- \`pipeline serve\` — Start webhook server
- \`pipeline status\` — Show active tasks, caches, connections

## Dependencies
- claude CLI
- Gemini API key (GEMINI_API_KEY)
- Node.js >= 22
`;
