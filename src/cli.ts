#!/usr/bin/env node
import { Command } from 'commander';
import { config } from 'dotenv';

config();

const program = new Command();

program
  .name('pipeline')
  .description('AI Agent Pipeline — Gemini orchestrator + Claude Code executor')
  .version('2.0.0')
  .addHelpText('after','\nExamples:\n  $ pipeline research "How to optimize React rendering"\n  $ pipeline run "Build a REST API" --ttl 5 --mode EXECUTE\n  $ pipeline dispatch tasks/batch-001.json --dry-run\n  $ pipeline health --json\n  $ pipeline status');

program
  .command('research <prompt>')
  .description('Phase 1: Deep research via Gemini')
  .option('-o, --output <file>', 'Output file for research results')
  .addHelpText('after','\nExamples:\n  $ pipeline research "How to optimize React rendering"\n  $ pipeline research "Best practices for TypeScript monorepos" -o research/ts-monorepo.json')
  .action(async (prompt, opts) => {
    const { researchCommand } = await import('./commands/research.js');
    await researchCommand(prompt, opts);
  });

program
  .command('decompose <file>')
  .description('Phase 2: Decompose research into task blueprints')
  .option('-o, --output <file>', 'Output file for task blueprints')
  .addHelpText('after','\nExamples:\n  $ pipeline decompose research/output.json\n  $ pipeline decompose research/output.json -o tasks/batch-001.json')
  .action(async (file, opts) => {
    const { decomposeCommand } = await import('./commands/decompose.js');
    await decomposeCommand(file, opts);
  });

program
  .command('dispatch <tasks>')
  .description('Run task blueprints through the completion loop')
  .option('--dry-run', 'Validate and classify tasks without executing')
  .option('--parallel', 'Execute independent tasks in parallel', true)
  .addHelpText('after','\nExamples:\n  $ pipeline dispatch tasks/batch-001.json\n  $ pipeline dispatch tasks/batch-001.json --dry-run\n  $ pipeline dispatch tasks/batch-001.json --parallel')
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
  .addHelpText('after','\nExamples:\n  $ pipeline run "Build a REST API"\n  $ pipeline run "Build a REST API" --ttl 5 --mode EXECUTE\n  $ pipeline run "Optimize database queries" --dry-run')
  .action(async (prompt, opts) => {
    const { runCommand } = await import('./commands/run.js');
    await runCommand(prompt, opts);
  });

program
  .command('validate <file>')
  .description('Validate a file against pipeline schemas')
  .option('-s, --schema <schema>', 'Schema to validate against (task|report|envelope|routing)')
  .addHelpText('after','\nExamples:\n  $ pipeline validate tasks/batch-001.json --schema task\n  $ pipeline validate output/report.json --schema report')
  .action(async (file, opts) => {
    const { validateCommand } = await import('./commands/validate.js');
    await validateCommand(file, opts);
  });

const deadLetter = program
  .command('dead-letter')
  .description('Dead-letter queue management')
  .addHelpText('after','\nSubcommands:\n  list              List all items in the dead-letter queue\n  retry <id>        Retry a dead-letter item by ID\n  delete <id>       Delete a dead-letter item by ID\n  inspect <id>      Inspect a dead-letter item by ID\n\nExamples:\n  $ pipeline dead-letter list\n  $ pipeline dead-letter retry dl-001\n  $ pipeline dead-letter delete dl-001\n  $ pipeline dead-letter inspect dl-001');

deadLetter
  .command('list')
  .description('List items in the dead-letter queue')
  .addHelpText('after','\nExamples:\n  $ pipeline dead-letter list')
  .action(async () => {
    const { deadLetterListCommand } = await import('./commands/dead-letter.js');
    await deadLetterListCommand();
  });

deadLetter
  .command('retry <id>')
  .description('Retry a dead-letter item (resets envelope and removes from DLQ)')
  .addHelpText('after','\nExamples:\n  $ pipeline dead-letter retry dl-001')
  .action(async (id) => {
    const { deadLetterRetryCommand } = await import('./commands/dead-letter.js');
    await deadLetterRetryCommand(id);
  });

deadLetter
  .command('delete <id>')
  .description('Delete a dead-letter item')
  .addHelpText('after','\nExamples:\n  $ pipeline dead-letter delete dl-001')
  .action(async (id) => {
    const { deadLetterDeleteCommand } = await import('./commands/dead-letter.js');
    await deadLetterDeleteCommand(id);
  });

deadLetter
  .command('inspect <id>')
  .description('Inspect a dead-letter item')
  .addHelpText('after','\nExamples:\n  $ pipeline dead-letter inspect dl-001\n  $ pipeline dead-letter inspect dl-abc123')
  .action(async (id) => {
    const { deadLetterInspectCommand } = await import('./commands/dead-letter.js');
    await deadLetterInspectCommand(id);
  });

program
  .command('serve')
  .description('Start webhook server for N8n callbacks and HITL responses')
  .option('-p, --port <port>', 'Port to listen on', '3847')
  .addHelpText('after','\nExamples:\n  $ pipeline serve\n  $ pipeline serve --port 3847\n  $ pipeline serve -p 8080')
  .action(async (opts) => {
    const { serveCommand } = await import('./commands/serve.js');
    await serveCommand(opts);
  });

program
  .command('legacy-dispatch <task-json>')
  .description('Dispatch a Legacy Agency task through the pipeline')
  .option('--dry-run', 'Convert and classify without executing')
  .addHelpText('after','\nExamples:\n  $ pipeline legacy-dispatch task.json\n  $ pipeline legacy-dispatch task.json --dry-run')
  .action(async (taskJson, opts) => {
    const { legacyDispatchCommand } = await import('./commands/legacy-dispatch.js');
    await legacyDispatchCommand(taskJson, opts);
  });

program
  .command('status')
  .description('Show active tasks, caches, and connections')
  .addHelpText('after','\nExamples:\n  $ pipeline status')
  .action(async () => {
    const { statusCommand } = await import('./commands/status.js');
    await statusCommand();
  });

program
  .command('benchmarks')
  .description('Phase 7: Performance Benchmarking — analyze cluster latency and costs')
  .option('--json', 'Output as raw JSON')
  .addHelpText('after','\nExamples:\n  $ pipeline benchmarks\n  $ pipeline benchmarks --json')
  .action(async (opts) => {
    const { benchmarksCommand } = await import('./commands/benchmarks.js');
    await benchmarksCommand(opts);
  });

program
  .command('auto-decompose')
  .description('Phase 7: Autonomous Task Creation — scan repo for gaps and generate blueprints')
  .addHelpText('after','\nExamples:\n  $ pipeline auto-decompose')
  .action(async () => {
    const { autoDecomposeCommand } = await import('./commands/auto-decompose.js');
    await autoDecomposeCommand();
  });

program
  .command('watchdog')
  .description('Phase 7: Self-Healing Watchdog — monitor and recover stalled nodes')
  .option('-i, --interval <seconds>', 'Check interval', '60')
  .option('--once', 'Run once and exit')
  .addHelpText('after','\nExamples:\n  $ pipeline watchdog\n  $ pipeline watchdog --interval 30\n  $ pipeline watchdog --once')
  .action(async (opts) => {
    const { watchdogCommand } = await import('./commands/watchdog.js');
    await watchdogCommand(opts);
  });

program
  .command('health')
  .description('Check pipeline health status')
  .option('--json', 'Output as JSON')
  .addHelpText('after','\nExamples:\n  $ pipeline health\n  $ pipeline health --json')
  .action(async (opts) => {
    const { healthCommand } = await import('./commands/health.js');
    await healthCommand(opts);
  });

const registry = program
  .command('registry')
  .description('Distributed worker node registry management')
  .addHelpText('after','\nSubcommands:\n  list              List all registered worker nodes\n  status            Show registry summary (online/busy/offline)\n  reap              Mark stale nodes (no heartbeat) as OFFLINE\n\nExamples:\n  $ pipeline registry list\n  $ pipeline registry status\n  $ pipeline registry reap');

registry
  .command('list')
  .description('List all registered nodes')
  .action(async () => {
    const { registryListCommand } = await import('./commands/registry.js');
    await registryListCommand();
  });

registry
  .command('status')
  .description('Show registry summary')
  .action(async () => {
    const { registryStatusCommand } = await import('./commands/registry.js');
    await registryStatusCommand();
  });

registry
  .command('reap')
  .description('Mark silent nodes as OFFLINE')
  .action(async () => {
    const { registryReapCommand } = await import('./commands/registry.js');
    await registryReapCommand();
  });

program
  .command('escalation')
  .description('Human escalation dashboard -- STUCK/ESCALATED/BLOCKED tasks')
  .option('--json', 'Output as JSON')
  .option('-w, --watch <interval>', 'Auto-refresh every N seconds')
  .addHelpText('after','\nExamples:\n  $ pipeline escalation\n  $ pipeline escalation --json\n  $ pipeline escalation --watch 10')
  .action(async (opts) => {
    const { escalationCommand } = await import('./commands/escalation.js');
    await escalationCommand(opts);
  });

program
  .command('recovery')
  .description('Phase 4: Automated Task Recovery — re-dispatch eligible DLQ items')
  .option('--dry-run', 'List recoverable items without executing')
  .option('--limit <number>', 'Maximum items to recover', '5')
  .addHelpText('after','\nExamples:\n  $ pipeline recovery\n  $ pipeline recovery --dry-run\n  $ pipeline recovery --limit 10')
  .action(async (opts) => {
    const { recoveryCommand } = await import('./commands/recovery.js');
    await recoveryCommand(opts);
  });

const audit = program
  .command('audit')
  .description('Audit trail management')
  .addHelpText('after','\nSubcommands:\n  list              List audit entries for today or a specific date\n  verify            Verify HMAC integrity of audit log\n\nExamples:\n  $ pipeline audit list\n  $ pipeline audit list -d 2026-02-26\n  $ pipeline audit verify\n  $ pipeline audit verify -d 2026-02-26');

audit
  .command('list')
  .description('List audit entries for today (or a specific date)')
  .option('-d, --date <date>', 'Date in YYYY-MM-DD format')
  .addHelpText('after','\nExamples:\n  $ pipeline audit list\n  $ pipeline audit list -d 2026-02-26')
  .action(async (opts) => {
    const { auditListCommand } = await import('./commands/audit.js');
    await auditListCommand(opts);
  });

audit
  .command('verify')
  .description('Verify HMAC integrity of audit log')
  .option('-d, --date <date>', 'Date in YYYY-MM-DD format')
  .addHelpText('after','\nExamples:\n  $ pipeline audit verify\n  $ pipeline audit verify -d 2026-02-26')
  .action(async (opts) => {
    const { auditVerifyCommand } = await import('./commands/audit.js');
    await auditVerifyCommand(opts);
  });

// Wire ErrorMonitor to capture unhandled rejections from CLI commands
process.on('unhandledRejection', (reason) => {
  import('./monitoring/index.js').then(({ getMonitor }) => {
    void getMonitor().recordError('api','api_error','CLI unhandled rejection: '+String(reason));
  }).catch(() => {});
});

await program.parseAsync();
