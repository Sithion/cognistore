#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { KnowledgeSDK } from '@ai-knowledge/sdk';
import { createServer } from './server.js';

async function main() {
  const sdk = new KnowledgeSDK({ autoStart: false });

  try {
    await sdk.initialize();
  } catch (error) {
    console.error('Failed to initialize AI Knowledge SDK:', error instanceof Error ? error.message : error);
    process.exit(1);
  }

  const server = createServer(sdk);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Graceful shutdown
  const shutdown = async () => {
    await sdk.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
