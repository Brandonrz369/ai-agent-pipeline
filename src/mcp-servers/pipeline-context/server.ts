import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { listReports, searchReports, getReport } from './index.js';

const server = new Server(
  {
    name: 'pipeline-context',
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
        name: 'list_reports',
        description: 'List all available worker reports from previous tasks',
        inputSchema: {
          type: 'object' as const,
          properties: {},
        },
      },
      {
        name: 'search_reports',
        description: 'Search across all worker reports for a specific keyword or pattern (RAG)',
        inputSchema: {
          type: 'object' as const,
          properties: {
            query: {
              type: 'string',
              description: 'Keyword or search term',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'get_report_details',
        description: 'Retrieve the full content of a specific worker report by ID',
        inputSchema: {
          type: 'object' as const,
          properties: {
            id: {
              type: 'string',
              description: 'The report filename/ID (e.g. n1_docs_batch1.md)',
            },
          },
          required: ['id'],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'list_reports': {
      const reports = await listReports();
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(reports, null, 2) }],
      };
    }

    case 'search_reports': {
      const { query } = args as { query: string };
      const results = await searchReports(query);
      return {
        content: [
          {
            type: 'text' as const,
            text: results.length > 0 
              ? JSON.stringify(results, null, 2)
              : `No reports matching query: ${query}`
          },
        ],
      };
    }

    case 'get_report_details': {
      const { id } = args as { id: string };
      const report = await getReport(id);
      if (!report) {
        return {
          content: [{ type: 'text' as const, text: `Report not found: ${id}` }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text' as const, text: report.content }],
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
  console.error('Pipeline Context MCP server started on stdio');
}

main().catch((err) => {
  console.error('MCP server fatal error:', err);
  process.exit(1);
});
