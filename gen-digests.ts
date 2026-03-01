import { createHash } from 'node:crypto';
import { loadMcpConfig } from './src/config/loader.js';

async function generate() {
  const config = await loadMcpConfig();
  console.log('--- Approved Digests ---');
  
  for (const [name, server] of Object.entries(config.servers)) {
    const hash = createHash('sha256');
    hash.update(server.command);
    for (const arg of server.args) {
      hash.update(arg);
    }
    const digest = `sha256:${hash.digest('hex').slice(0, 16)}...`;
    console.log(`${name}: "${digest}"`);
  }
}

generate();
