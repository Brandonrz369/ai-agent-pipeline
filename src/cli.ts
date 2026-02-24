#!/usr/bin/env node
import { Command } from 'commander';
import { config } from 'dotenv';

config();

const program = new Command();

program
  .name('pipeline')
  .description('AI Agent Pipeline — Gemini orchestrator + Claude Code executor')
  .version('2.0.0');

program
  .command('research <prompt>')
  .description('Phase 1: Deep research via Gemini')
  .option('-o, --output <file>', 'Output file for research results')
  .action(async (prompt, opts) => {
    const { researchCommand } = await import('./commands/research.js');
    await researchCommand(prompt, opts);
  });

program
  .command('decompose <file>')
  .description('Phase 2: Decompose research into task blueprints')
  .option('-o, --output <file>', 'Output file for task blueprints')
  .action(async (file, opts) => {
    const { decomposeCommand } = await import('./commands/decompose.js');
    await decomposeCommand(file, opts);
  });

program
  .command('dispatch <tasks>')
  .description('Run task blueprints through the completion loop')
  .option('--dry-run', 'Validate and classify tasks without executing')
  .option('--parallel', 'Execute independent tasks in parallel', true)
  .action(async (tasks, opts) => {
    const { dispatchCommand } = await import('./commands/dispatch.js');
    await dispatchCommand(tasks, opts);
  });

program
  .command('run <prompt>')
  .description('Full pipeline: research → decompose → dispatch')
  .option('--ttl <number>', 'Max hops per task', '10')
  .option('--mode <mode>', 'Initial prompt mode', 'EXECUTE')
  .option('--dry-run', 'Skip Gemini API calls, use synthetic task for testing')
  .action(async (prompt, opts) => {
    const { runCommand } = await import('./commands/run.js');
    await runCommand(prompt, opts);
  });

program
  .command('validate <file>')
  .description('Validate a file against pipeline schemas')
  .option('-s, --schema <schema>', 'Schema to validate against (task|report|envelope|routing)')
  .action(async (file, opts) => {
    const { validateCommand } = await import('./commands/validate.js');
    await validateCommand(file, opts);
  });

const deadLetter = program
  .command('dead-letter')
  .description('Dead-letter queue management');

deadLetter
  .command('list')
  .description('List items in the dead-letter queue')
  .action(async () => {
    const { deadLetterListCommand } = await import('./commands/dead-letter.js');
    await deadLetterListCommand();
  });

deadLetter
  .command('retry <id>')
  .description('Retry a dead-letter item')
  .action(async (id) => {
    const { deadLetterRetryCommand } = await import('./commands/dead-letter.js');
    await deadLetterRetryCommand(id);
  });

deadLetter
  .command('inspect <id>')
  .description('Inspect a dead-letter item')
  .action(async (id) => {
    const { deadLetterInspectCommand } = await import('./commands/dead-letter.js');
    await deadLetterInspectCommand(id);
  });

program
  .command('serve')
  .description('Start webhook server for N8n callbacks and HITL responses')
  .option('-p, --port <port>', 'Port to listen on', '3847')
  .action(async (opts) => {
    const { serveCommand } = await import('./commands/serve.js');
    await serveCommand(opts);
  });

program
  .command('status')
  .description('Show active tasks, caches, and connections')
  .action(async () => {
    const { statusCommand } = await import('./commands/status.js');
    await statusCommand();
  });

const audit = program
  .command('audit')
  .description('Audit trail management');

audit
  .command('list')
  .description('List audit entries for today (or a specific date)')
  .option('-d, --date <date>', 'Date in YYYY-MM-DD format')
  .action(async (opts) => {
    const { auditListCommand } = await import('./commands/audit.js');
    await auditListCommand(opts);
  });

audit
  .command('verify')
  .description('Verify HMAC integrity of audit log')
  .option('-d, --date <date>', 'Date in YYYY-MM-DD format')
  .action(async (opts) => {
    const { auditVerifyCommand } = await import('./commands/audit.js');
    await auditVerifyCommand(opts);
  });

program.parse();
