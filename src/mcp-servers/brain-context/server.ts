import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { storeContext, getSummary, listContextKeys, deleteContext, getStoreStats } from './index.js';

const API_KEY = process.env.GEMINI_API_KEY || '';

const server = new Server(
  {
    name: 'brain-context',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'store_context',
        description:
          'Compress and store context to prevent brain damage from context overflow. Sends content to Gemini Flash-Lite for ~200 token compression.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            key: {
              type: 'string',
              description: 'Cache key in format: {task_id}-{session_id}-{block_name}',
            },
            content: {
              type: 'string',
              description: 'The content to compress and store (can be large)',
            },
          },
          required: ['key', 'content'],
        },
      },
      {
        name: 'get_summary',
        description: 'Retrieve a compressed context summary by key',
        inputSchema: {
          type: 'object' as const,
          properties: {
            key: {
              type: 'string',
              description: 'The cache key to look up',
            },
          },
          required: ['key'],
        },
      },
      {
        name: 'list_keys',
        description: 'List all stored context keys',
        inputSchema: {
          type: 'object' as const,
          properties: {},
        },
      },
      {
        name: 'delete_context',
        description: 'Delete a stored context entry',
        inputSchema: {
          type: 'object' as const,
          properties: {
            key: {
              type: 'string',
              description: 'The cache key to delete',
            },
          },
          required: ['key'],
        },
      },
      {
        name: 'stats',
        description: 'Get brain context store statistics',
        inputSchema: {
          type: 'object' as const,
          properties: {},
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'store_context': {
      const { key, content } = args as { key: string; content: string };
      if (!API_KEY) {
        return {
          content: [{ type: 'text' as const, text: 'Error: GEMINI_API_KEY not set' }],
          isError: true,
        };
      }
      const entry = await storeContext(key, content, API_KEY);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              stored: true,
              key: entry.key,
              original_tokens: entry.original_tokens,
              compressed_tokens: entry.compressed_tokens,
              summary_preview: entry.summary.slice(0, 100) + '...',
            }),
          },
        ],
      };
    }

    case 'get_summary': {
      const { key } = args as { key: string };
      const summary = await getSummary(key);
      if (!summary) {
        return {
          content: [{ type: 'text' as const, text: `No context found for key: ${key}` }],
        };
      }
      return {
        content: [{ type: 'text' as const, text: summary }],
      };
    }

    case 'list_keys': {
      const keys = await listContextKeys();
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(keys, null, 2) }],
      };
    }

    case 'delete_context': {
      const { key } = args as { key: string };
      const deleted = await deleteContext(key);
      return {
        content: [{ type: 'text' as const, text: deleted ? `Deleted: ${key}` : `Not found: ${key}` }],
      };
    }

    case 'stats': {
      const stats = await getStoreStats();
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(stats, null, 2) }],
      };
    }

    default:
      return {
        content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
        isError: true,
      };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Brain Context MCP server started on stdio');
}

main().catch((err) => {
  console.error('MCP server fatal error:', err);
  process.exit(1);
});
