import type { PromptMode } from '../types/index.js';

export interface ModeConfig {
  template: string;
  allowedTools: string[];
  flags: string[];
  description: string;
}

const MODE_CONFIGS: Record<PromptMode, ModeConfig> = {
  EXECUTE: {
    template: 'templates/execute-prompt.md',
    allowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'gemini-cache'],
    flags: ['--output-format', 'json'],
    description: 'Full tool access — code generation, file editing, command execution',
  },
  ARCHITECT: {
    template: 'templates/architect-prompt.md',
    allowedTools: ['Read'],
    flags: ['--output-format', 'json', '--allowedTools', 'Read'],
    description: 'Read-only deep reasoning — root cause analysis after 3 failures',
  },
  SUPERVISE: {
    template: 'templates/supervise-prompt.md',
    allowedTools: ['computer_use', 'Bash', 'Read', 'Write', 'gemini-cache'],
    flags: ['--output-format', 'json'],
    description: 'Computer Use enabled — GUI automation with screenshots',
  },
};

export function getModeConfig(mode: PromptMode): ModeConfig {
  return MODE_CONFIGS[mode];
}

export function getCliFlags(mode: PromptMode): string[] {
  return MODE_CONFIGS[mode].flags;
}

export function getTemplatePath(mode: PromptMode): string {
  return MODE_CONFIGS[mode].template;
}
