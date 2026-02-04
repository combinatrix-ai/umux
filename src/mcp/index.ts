#!/usr/bin/env node
/**
 * umux MCP Server
 *
 * Provides terminal multiplexer functionality to AI agents via the
 * Model Context Protocol (MCP).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Umux } from '../core/index.js';
import { registerTools } from './tools.js';

async function main() {
  // Create umux instance
  const umux = new Umux();

  // Create MCP server
  const server = new McpServer({
    name: 'umux',
    version: '0.0.1',
  });

  // Register all tools
  registerTools(server, umux);

  // Connect via stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Handle graceful shutdown
  const cleanup = () => {
    umux.destroy();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

main().catch((err) => {
  console.error('MCP server error:', err);
  process.exit(1);
});
