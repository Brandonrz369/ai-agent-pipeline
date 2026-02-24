import { logger } from './logger.js';
import { withRetry } from './retry.js';

const ANTIGRAVITY_URL = process.env.ANTIGRAVITY_URL || 'http://127.0.0.1:8080';
const DEFAULT_MODEL = process.env.ANTIGRAVITY_MODEL || 'gemini-3.1-pro-high';

export interface AntigravityResponse {
  text: string;
}

/**
 * Client for the Antigravity proxy — routes Gemini calls through localhost:8080.
 *
 * The Antigravity proxy speaks the Anthropic Messages API format but routes to
 * Gemini models. This lets the pipeline use Gemini 3.1 Pro (which has zero
 * direct API quota) through the proxy.
 */
export class AntigravityClient {
  private baseUrl: string;
  private model: string;

  constructor(model?: string, baseUrl?: string) {
    this.baseUrl = baseUrl || ANTIGRAVITY_URL;
    this.model = model || DEFAULT_MODEL;
  }

  async generateContent(prompt: string, maxTokens = 4096): Promise<AntigravityResponse> {
    return withRetry(
      () => this._call(prompt, maxTokens),
      `Antigravity(${this.model})`,
    );
  }

  private async _call(prompt: string, maxTokens: number): Promise<AntigravityResponse> {
    const body = JSON.stringify({
      model: this.model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    });

    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'pipeline',
        'anthropic-version': '2023-06-01',
      },
      body,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Antigravity ${res.status}: ${errText.slice(0, 300)}`);
    }

    const data = await res.json() as {
      content?: Array<{ type: string; text?: string }>;
      error?: unknown;
    };

    if (data.error) {
      throw new Error(`Antigravity error: ${JSON.stringify(data.error)}`);
    }

    // Anthropic format: { content: [{ type: "text", text: "..." }] }
    const text = data.content
      ?.filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('') ?? '';

    if (!text) {
      logger.warn('Antigravity returned empty text', { model: this.model });
    }

    return { text };
  }
}

/** Shared instance for convenience */
let _defaultClient: AntigravityClient | null = null;

export function getAntigravityClient(model?: string): AntigravityClient {
  if (!_defaultClient || model) {
    _defaultClient = new AntigravityClient(model);
  }
  return _defaultClient;
}
