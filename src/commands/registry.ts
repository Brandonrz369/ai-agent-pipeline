import { GeminiOrchestrator } from '../orchestrator/index.js';
import { logger } from '../utils/logger.js';

export async function registryListCommand() {
  const orchestrator = new GeminiOrchestrator();
  // In a real distributed scenario, this would load from a shared state (Redis/DB)
  // For now, it shows the local in-memory registry state
  const nodes = orchestrator.registry.getOnlineNodes();

  if (nodes.length === 0) {
    console.log('No online nodes registered.');
    return;
  }

  console.log(`Registered Nodes (${nodes.length}):\n`);
  for (const node of nodes) {
    console.log(`  [${node.status}] ${node.id} (${node.hostname})`);
    console.log(`    Address: ${node.ip}:${node.port}`);
    console.log(`    Load: ${node.load_average.toFixed(2)}`);
    console.log(`    Last Seen: ${node.last_seen}`);
    console.log('');
  }
}

export async function registryStatusCommand() {
  const orchestrator = new GeminiOrchestrator();
  const summary = orchestrator.registry.getSummary();

  console.log('Worker Registry Status:');
  console.log(`  Online:   ${summary.online}`);
  console.log(`  Busy:     ${summary.busy}`);
  console.log(`  Offline:  ${summary.offline}`);
  console.log(`  Total:    ${summary.total}`);
}
