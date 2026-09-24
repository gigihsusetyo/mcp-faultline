#!/usr/bin/env node
// tests/fixtures/mock-mcp-server.mjs
//
// Minimal MCP server over stdio for smoke-testing the proxy.
// Exposes a single tool: `echo` → returns its `message` argument.
// No dependencies beyond @modelcontextprotocol/sdk.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const server = new Server(
  { name: 'mock-mcp-server', version: '0.0.1' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'echo',
      description: 'Echo back the provided message',
      inputSchema: {
        type: 'object',
        properties: {
          message: { type: 'string' },
        },
        required: ['message'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  if (name !== 'echo') {
    return {
      isError: true,
      content: [{ type: 'text', text: `unknown tool: ${name}` }],
    };
  }
  const message = (args && args.message) ?? '';
  return {
    content: [{ type: 'text', text: String(message) }],
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);