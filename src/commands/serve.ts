import { PipelineGateway } from '../gateway/index.js';

export async function serveCommand(opts: { port?: string }) {
  const port = parseInt(opts.port || '3847', 10);
  const gateway = new PipelineGateway({ port });

  console.log(`Starting pipeline webhook server on port ${port}...`);
  await gateway.startWebhookServer();

  console.log(`
Pipeline webhook server running:
  Health:    http://localhost:${port}/health
  Dispatch:  POST http://localhost:${port}/webhook/dispatch
  N8n:       POST http://localhost:${port}/webhook/n8n-callback
  HITL:      POST http://localhost:${port}/webhook/hitl-response

Press Ctrl+C to stop.
`);

  // Keep alive
  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await gateway.stopWebhookServer();
    process.exit(0);
  });
}
