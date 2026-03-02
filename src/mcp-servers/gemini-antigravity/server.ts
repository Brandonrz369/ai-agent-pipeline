/**
 * Gemini Antigravity MCP Server
 *
 * Routes Gemini MCP tool calls through the Antigravity proxy (localhost:8080)
 * instead of hitting the Google API directly. This uses the paid Gemini plan
 * via OpenClaw OAuth — no separate API key needed, no rate limits.
 *
 * Exposes the same tool names as @rlabs-inc/gemini-mcp so agents can use
 * familiar tool names while routing through Antigravity.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { readFileSync } from 'fs';

const ANTIGRAVITY_URL = process.env.ANTIGRAVITY_URL || 'http://127.0.0.1:8080';
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-pro-high';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash';

// ─── Antigravity client ──────────────────────────────────────────────

interface AntigravityMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AntigravityResponse {
  id: string;
  type: string;
  role: string;
  content: Array<{ type: string; text: string }>;
  model: string;
  stop_reason: string;
}

async function callAntigravity(
  messages: AntigravityMessage[],
  opts: {
    system?: string;
    maxTokens?: number;
    temperature?: number;
  } = {},
): Promise<string> {
  try {
    return await _callAntigravityProxy(messages, opts);
  } catch (antigravityErr) {
    if (!OPENROUTER_API_KEY) {
      throw antigravityErr;
    }
    console.error(
      `Antigravity proxy failed, falling back to OpenRouter: ${antigravityErr instanceof Error ? antigravityErr.message : String(antigravityErr)}`,
    );
    return await _callOpenRouter(messages, opts);
  }
}

async function _callAntigravityProxy(
  messages: AntigravityMessage[],
  opts: {
    system?: string;
    maxTokens?: number;
    temperature?: number;
  } = {},
): Promise<string> {
  const body: Record<string, unknown> = {
    model: MODEL,
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
    max_tokens: opts.maxTokens ?? 8192,
  };

  if (opts.system) {
    body.system = opts.system;
  }
  if (opts.temperature !== undefined) {
    body.temperature = opts.temperature;
  }

  const response = await fetch(`${ANTIGRAVITY_URL}/v1/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Antigravity ${response.status}: ${errorText}`);
  }

  const data = (await response.json()) as AntigravityResponse;
  const textBlocks = data.content?.filter((b) => b.type === 'text') ?? [];
  return textBlocks.map((b) => b.text).join('\n');
}

async function _callOpenRouter(
  messages: AntigravityMessage[],
  opts: {
    system?: string;
    maxTokens?: number;
    temperature?: number;
  } = {},
): Promise<string> {
  // Convert Anthropic Messages API format to OpenAI chat completions format
  const openRouterMessages: Array<{ role: string; content: string }> = [];

  if (opts.system) {
    openRouterMessages.push({ role: 'system', content: opts.system });
  }

  for (const m of messages) {
    openRouterMessages.push({ role: m.role, content: m.content });
  }

  const body: Record<string, unknown> = {
    model: OPENROUTER_MODEL,
    max_tokens: opts.maxTokens ?? 8192,
    messages: openRouterMessages,
  };

  if (opts.temperature !== undefined) {
    body.temperature = opts.temperature;
  }

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter ${response.status}: ${errorText}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: unknown;
  };

  if (data.error) {
    throw new Error(`OpenRouter error: ${JSON.stringify(data.error)}`);
  }

  return data.choices?.[0]?.message?.content ?? '';
}

// ─── Local cache store (for gemini-create-cache / gemini-query-cache) ─

interface CacheEntry {
  displayName: string;
  content: string;
  createdAt: number;
  ttlMinutes: number;
  systemInstruction?: string;
}

const cacheStore = new Map<string, CacheEntry>();

// ─── MCP Server setup ────────────────────────────────────────────────

const server = new Server(
  { name: 'gemini-antigravity', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

// ─── Tool definitions ────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'gemini-query',
      description:
        'Send a query to Gemini 3.1 Pro via Antigravity proxy. General-purpose reasoning, analysis, and generation.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          prompt: { type: 'string', description: 'The prompt to send to Gemini' },
          model: {
            type: 'string',
            enum: ['pro', 'flash'],
            description: 'Model tier (pro or flash). Default: pro',
          },
        },
        required: ['prompt'],
      },
    },
    {
      name: 'gemini-brainstorm',
      description:
        'Multi-round brainstorming with Gemini. Provide a problem and initial thoughts for iterative exploration.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          prompt: { type: 'string', description: 'The problem to brainstorm about' },
          claudeThoughts: {
            type: 'string',
            description: "Claude's initial thoughts on the problem",
          },
          maxRounds: {
            type: 'number',
            description: 'Max brainstorming rounds (1-5). Default: 3',
          },
        },
        required: ['prompt'],
      },
    },
    {
      name: 'gemini-analyze-code',
      description:
        'Analyze code for quality, security, performance, or bugs via Gemini.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          code: { type: 'string', description: 'The code to analyze' },
          language: { type: 'string', description: 'Programming language' },
          focus: {
            type: 'string',
            enum: ['quality', 'security', 'performance', 'bugs', 'general'],
            description: 'Analysis focus. Default: general',
          },
        },
        required: ['code'],
      },
    },
    {
      name: 'gemini-search',
      description:
        'Web-grounded search via Gemini. Returns current information with citations.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          query: { type: 'string', description: 'Search query' },
        },
        required: ['query'],
      },
    },
    {
      name: 'gemini-deep-research',
      description:
        'Long-form research on a topic. Returns comprehensive analysis with sources.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          query: { type: 'string', description: 'Research question or topic' },
          format: {
            type: 'string',
            description: 'Output format (e.g., "technical report with sections")',
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'gemini-create-cache',
      description:
        'Cache large content for repeated queries. Avoids re-reading big files.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          filePath: { type: 'string', description: 'Path to file to cache' },
          displayName: { type: 'string', description: 'Name to identify this cache' },
          ttlMinutes: {
            type: 'number',
            description: 'Time to live in minutes (default: 60)',
          },
          systemInstruction: {
            type: 'string',
            description: 'System instruction to include with cache',
          },
        },
        required: ['filePath', 'displayName'],
      },
    },
    {
      name: 'gemini-query-cache',
      description: 'Query previously cached content by name.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          cacheName: { type: 'string', description: 'Cache display name' },
          question: {
            type: 'string',
            description: 'Question about the cached content',
          },
        },
        required: ['cacheName', 'question'],
      },
    },
    {
      name: 'gemini-list-caches',
      description: 'List all active caches.',
      inputSchema: {
        type: 'object' as const,
        properties: {},
      },
    },
    {
      name: 'gemini-delete-cache',
      description: 'Delete a cache by name.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          cacheName: { type: 'string', description: 'Cache name to delete' },
        },
        required: ['cacheName'],
      },
    },
    {
      name: 'gemini-analyze-document',
      description: 'Analyze a document file (PDF, TXT, CSV, etc.) via Gemini.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          filePath: { type: 'string', description: 'Path to the document' },
          question: {
            type: 'string',
            description: 'Question about the document',
          },
        },
        required: ['filePath', 'question'],
      },
    },
    {
      name: 'gemini-structured',
      description:
        'Get structured JSON output from Gemini following a schema.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          prompt: { type: 'string', description: 'The prompt to process' },
          schema: {
            type: 'string',
            description: 'JSON Schema as a string for the output format',
          },
        },
        required: ['prompt', 'schema'],
      },
    },
    {
      name: 'gemini-extract',
      description:
        'Extract structured information (entities, facts, keywords, etc.) from text.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          text: { type: 'string', description: 'Text to extract from' },
          extractType: {
            type: 'string',
            enum: ['entities', 'facts', 'summary', 'keywords', 'sentiment', 'custom'],
            description: 'What to extract',
          },
          customFields: {
            type: 'string',
            description: 'For custom: comma-separated fields to extract',
          },
        },
        required: ['text', 'extractType'],
      },
    },
    {
      name: 'gemini-summarize',
      description: 'Summarize content in various formats and lengths.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          content: { type: 'string', description: 'Content to summarize' },
          format: {
            type: 'string',
            enum: ['paragraph', 'bullet-points', 'outline'],
            description: 'Output format. Default: paragraph',
          },
          length: {
            type: 'string',
            enum: ['brief', 'moderate', 'detailed'],
            description: 'Summary length. Default: moderate',
          },
        },
        required: ['content'],
      },
    },
    {
      name: 'gemini-count-tokens',
      description: 'Count tokens in text content.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          content: { type: 'string', description: 'Text to count tokens for' },
        },
        required: ['content'],
      },
    },
  ],
}));

// ─── Tool implementations ────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'gemini-query': {
        const { prompt } = args as { prompt: string };
        const result = await callAntigravity([{ role: 'user', content: prompt }]);
        return { content: [{ type: 'text' as const, text: result }] };
      }

      case 'gemini-brainstorm': {
        const { prompt, claudeThoughts, maxRounds = 3 } = args as {
          prompt: string;
          claudeThoughts?: string;
          maxRounds?: number;
        };
        const systemPrompt =
          'You are a brainstorming partner. Challenge assumptions, suggest alternatives, and build on ideas iteratively.';
        const messages: AntigravityMessage[] = [
          {
            role: 'user',
            content: `Problem: ${prompt}\n\n${claudeThoughts ? `Initial thoughts from Claude: ${claudeThoughts}\n\n` : ''}Please provide ${maxRounds} rounds of brainstorming, each building on the previous.`,
          },
        ];
        const result = await callAntigravity(messages, {
          system: systemPrompt,
          maxTokens: 16384,
        });
        return { content: [{ type: 'text' as const, text: result }] };
      }

      case 'gemini-analyze-code': {
        const { code, language, focus = 'general' } = args as {
          code: string;
          language?: string;
          focus?: string;
        };
        const prompt = `Analyze this ${language || ''} code with focus on: ${focus}\n\n\`\`\`${language || ''}\n${code}\n\`\`\``;
        const result = await callAntigravity([{ role: 'user', content: prompt }], {
          system: `You are a senior code reviewer. Focus your analysis on: ${focus}. Be specific and actionable.`,
        });
        return { content: [{ type: 'text' as const, text: result }] };
      }

      case 'gemini-search': {
        const { query } = args as { query: string };
        const result = await callAntigravity(
          [{ role: 'user', content: `Search for current information about: ${query}\n\nProvide answers with inline citations where possible.` }],
          { system: 'You are a research assistant with access to current information. Provide accurate, well-sourced answers.' },
        );
        return { content: [{ type: 'text' as const, text: result }] };
      }

      case 'gemini-deep-research': {
        const { query, format } = args as { query: string; format?: string };
        const formatInstr = format ? `\n\nFormat the output as: ${format}` : '';
        const result = await callAntigravity(
          [
            {
              role: 'user',
              content: `Conduct thorough research on: ${query}${formatInstr}\n\nProvide comprehensive analysis with sources, multiple perspectives, and actionable conclusions.`,
            },
          ],
          {
            system:
              'You are a deep research analyst. Provide thorough, well-structured analysis with citations. Cover multiple angles and provide actionable conclusions.',
            maxTokens: 32768,
          },
        );
        return { content: [{ type: 'text' as const, text: result }] };
      }

      case 'gemini-create-cache': {
        const { filePath, displayName, ttlMinutes = 60, systemInstruction } = args as {
          filePath: string;
          displayName: string;
          ttlMinutes?: number;
          systemInstruction?: string;
        };
        const content = readFileSync(filePath, 'utf-8');
        cacheStore.set(displayName, {
          displayName,
          content,
          createdAt: Date.now(),
          ttlMinutes,
          systemInstruction,
        });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                cached: true,
                displayName,
                contentLength: content.length,
                ttlMinutes,
                expiresAt: new Date(Date.now() + ttlMinutes * 60000).toISOString(),
              }),
            },
          ],
        };
      }

      case 'gemini-query-cache': {
        const { cacheName, question } = args as {
          cacheName: string;
          question: string;
        };
        const entry = cacheStore.get(cacheName);
        if (!entry) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Cache "${cacheName}" not found. Available: ${[...cacheStore.keys()].join(', ') || 'none'}`,
              },
            ],
          };
        }
        // Check TTL
        if (Date.now() - entry.createdAt > entry.ttlMinutes * 60000) {
          cacheStore.delete(cacheName);
          return {
            content: [{ type: 'text' as const, text: `Cache "${cacheName}" has expired.` }],
          };
        }
        const result = await callAntigravity(
          [
            {
              role: 'user',
              content: `Based on the following cached content, answer this question: ${question}\n\n---CACHED CONTENT---\n${entry.content.slice(0, 100000)}\n---END CACHED CONTENT---`,
            },
          ],
          {
            system: entry.systemInstruction || 'Answer questions about the provided cached content accurately and concisely.',
          },
        );
        return { content: [{ type: 'text' as const, text: result }] };
      }

      case 'gemini-list-caches': {
        const caches = [...cacheStore.entries()].map(([name, entry]) => ({
          name,
          contentLength: entry.content.length,
          createdAt: new Date(entry.createdAt).toISOString(),
          expiresAt: new Date(
            entry.createdAt + entry.ttlMinutes * 60000,
          ).toISOString(),
          expired: Date.now() - entry.createdAt > entry.ttlMinutes * 60000,
        }));
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(caches, null, 2) }],
        };
      }

      case 'gemini-delete-cache': {
        const { cacheName } = args as { cacheName: string };
        const deleted = cacheStore.delete(cacheName);
        return {
          content: [
            {
              type: 'text' as const,
              text: deleted ? `Deleted cache: ${cacheName}` : `Cache not found: ${cacheName}`,
            },
          ],
        };
      }

      case 'gemini-analyze-document': {
        const { filePath, question } = args as {
          filePath: string;
          question: string;
        };
        const content = readFileSync(filePath, 'utf-8');
        const truncated = content.slice(0, 100000);
        const result = await callAntigravity(
          [
            {
              role: 'user',
              content: `${question}\n\n---DOCUMENT---\n${truncated}\n---END DOCUMENT---`,
            },
          ],
          {
            system: 'You are a document analyst. Answer questions about documents accurately and thoroughly.',
          },
        );
        return { content: [{ type: 'text' as const, text: result }] };
      }

      case 'gemini-structured': {
        const { prompt, schema } = args as { prompt: string; schema: string };
        const result = await callAntigravity(
          [
            {
              role: 'user',
              content: `${prompt}\n\nRespond with ONLY a JSON object matching this schema:\n${schema}`,
            },
          ],
          {
            system:
              'You are a structured data extraction engine. Always respond with valid JSON matching the provided schema. No markdown fences, no explanation — just the JSON.',
            temperature: 0,
          },
        );
        return { content: [{ type: 'text' as const, text: result }] };
      }

      case 'gemini-extract': {
        const { text, extractType, customFields } = args as {
          text: string;
          extractType: string;
          customFields?: string;
        };
        const extractPrompts: Record<string, string> = {
          entities: 'Extract all named entities (people, places, organizations, dates, amounts) from this text.',
          facts: 'Extract all factual claims from this text as a bulleted list.',
          summary: 'Provide a concise summary of this text.',
          keywords: 'Extract the most important keywords and phrases from this text.',
          sentiment: 'Analyze the sentiment of this text (positive/negative/neutral) with explanation.',
          custom: `Extract the following fields from this text: ${customFields || 'all relevant data'}`,
        };
        const result = await callAntigravity([
          {
            role: 'user',
            content: `${extractPrompts[extractType] || extractPrompts.custom}\n\nText:\n${text}`,
          },
        ]);
        return { content: [{ type: 'text' as const, text: result }] };
      }

      case 'gemini-summarize': {
        const { content, format = 'paragraph', length = 'moderate' } = args as {
          content: string;
          format?: string;
          length?: string;
        };
        const result = await callAntigravity([
          {
            role: 'user',
            content: `Summarize the following content. Format: ${format}. Length: ${length}.\n\n${content}`,
          },
        ]);
        return { content: [{ type: 'text' as const, text: result }] };
      }

      case 'gemini-count-tokens': {
        const { content } = args as { content: string };
        // Rough estimate: ~4 chars per token for English text
        const estimated = Math.ceil(content.length / 4);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                estimatedTokens: estimated,
                characters: content.length,
                note: 'Estimated at ~4 chars/token. Actual count may vary.',
              }),
            },
          ],
        };
      }

      default:
        return {
          content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [
        { type: 'text' as const, text: `Error in ${name}: ${message}` },
      ],
      isError: true,
    };
  }
});

// ─── Start server ────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `Gemini Antigravity MCP server started (proxy: ${ANTIGRAVITY_URL}, model: ${MODEL})`,
  );
}

main().catch((err) => {
  console.error('Gemini Antigravity MCP server fatal error:', err);
  process.exit(1);
});
