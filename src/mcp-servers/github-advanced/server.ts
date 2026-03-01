import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { GitHubWrapper, type PullRequestOptions } from '../../utils/github-wrapper.js';

const server = new Server(
  {
    name: 'github-advanced',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

const github = new GitHubWrapper();

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'create_pr_with_redteam',
        description: 'Create a GitHub Pull Request and automatically queue a mandatory Red Team review task.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            taskId: { type: 'string', description: 'The original task ID' },
            title: { type: 'string', description: 'PR Title' },
            body: { type: 'string', description: 'PR Description' },
            branch: { type: 'string', description: 'Feature branch name' },
            base: { type: 'string', description: 'Base branch (default: main)' },
          },
          required: ['taskId', 'title', 'body', 'branch'],
        },
      },
      {
        name: 'check_review_status',
        description: 'Check the status of the Red Team review for a specific PR.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            prNumber: { type: 'string', description: 'The PR number' },
          },
          required: ['prNumber'],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'create_pr_with_redteam': {
      const result = await github.createPRWithRedTeam(args as unknown as PullRequestOptions);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    }

    case 'check_review_status': {
      const { prNumber } = args as { prNumber: string };
      const status = await github.getReviewStatus(prNumber);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(status, null, 2) }],
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
  console.error('Advanced GitHub MCP server started on stdio');
}

main().catch((err) => {
  console.error('MCP server fatal error:', err);
  process.exit(1);
});
