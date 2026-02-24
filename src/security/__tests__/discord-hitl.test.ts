/**
 * Discord HITL Tests — T06 (Charlie)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createDiscordApprovalHandler,
  resolveApproval,
  listPendingApprovals,
} from '../discord-hitl.js';
import type { HITLGate, HITLApprovalRequest } from '../hitl.js';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeGate(overrides: Partial<HITLGate> = {}): HITLGate {
  return {
    id: 'HITL-001',
    trigger: /\bgit\s+push\b/i,
    severity: 'HIGH',
    timeoutMs: 5000, // Short timeout for tests
    defaultOnTimeout: 'REJECT',
    description: 'git push',
    ...overrides,
  };
}

function makeRequest(overrides: Partial<HITLApprovalRequest> = {}): HITLApprovalRequest {
  return {
    gate: makeGate(),
    action: 'git push origin main',
    taskId: 'TEST-001',
    context: { branch: 'main' },
    ...overrides,
  };
}

describe('Discord HITL', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('resolveApproval', () => {
    it('should return false when no pending approval exists', () => {
      const result = resolveApproval('HITL-999', 'APPROVE', 'TASK-999');
      expect(result).toBe(false);
    });
  });

  describe('listPendingApprovals', () => {
    it('should return empty array when no pending approvals', () => {
      const pending = listPendingApprovals();
      expect(pending).toEqual([]);
    });
  });

  describe('createDiscordApprovalHandler', () => {
    it('should return REJECT when no webhook URL configured', async () => {
      const handler = createDiscordApprovalHandler({});
      const req = makeRequest();
      const decision = await handler(req);
      expect(decision).toBe('REJECT'); // defaultOnTimeout
    });

    it('should send webhook and create pending approval', async () => {
      // Mock successful Discord webhook response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'msg-123' }),
      });
      // Mock follow-up message
      mockFetch.mockResolvedValueOnce({ ok: true });

      const handler = createDiscordApprovalHandler({
        webhookUrl: 'https://discord.com/api/webhooks/test/test',
        gatewayBaseUrl: 'http://localhost:3847',
      });

      const req = makeRequest({
        gate: makeGate({ timeoutMs: 500 }), // Very short timeout
      });

      // Start the approval (will timeout quickly)
      const decisionPromise = handler(req);

      // Verify webhook was called
      expect(mockFetch).toHaveBeenCalledOnce();
      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[0]).toContain('discord.com/api/webhooks');
      expect(fetchCall[1].method).toBe('POST');

      // Parse the sent payload
      const payload = JSON.parse(fetchCall[1].body);
      expect(payload.content).toContain('HITL Gate Triggered');
      expect(payload.embeds).toHaveLength(1);
      expect(payload.embeds[0].title).toContain('HITL-001');
      expect(payload.embeds[0].fields).toBeDefined();

      // Wait for timeout decision
      const decision = await decisionPromise;
      expect(decision).toBe('REJECT'); // defaultOnTimeout
    });

    it('should resolve APPROVE when resolveApproval is called before timeout', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'msg-456' }),
      });
      mockFetch.mockResolvedValueOnce({ ok: true });

      const handler = createDiscordApprovalHandler({
        webhookUrl: 'https://discord.com/api/webhooks/test/test',
      });

      const req = makeRequest({
        gate: makeGate({ timeoutMs: 10_000 }),
      });

      // Start approval
      const decisionPromise = handler(req);

      // Wait a tick for the webhook to be sent
      await new Promise((r) => setTimeout(r, 50));

      // Verify it's pending
      const pending = listPendingApprovals();
      expect(pending.length).toBeGreaterThan(0);
      expect(pending[0].gateId).toBe('HITL-001');

      // Resolve externally (as if webhook callback came in)
      const resolved = resolveApproval('HITL-001', 'APPROVE', 'TEST-001');
      expect(resolved).toBe(true);

      const decision = await decisionPromise;
      expect(decision).toBe('APPROVE');
    });

    it('should resolve REJECT when resolveApproval called with REJECT', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'msg-789' }),
      });
      mockFetch.mockResolvedValueOnce({ ok: true });

      const handler = createDiscordApprovalHandler({
        webhookUrl: 'https://discord.com/api/webhooks/test/test',
      });

      const req = makeRequest({
        gate: makeGate({ timeoutMs: 10_000 }),
      });

      const decisionPromise = handler(req);
      await new Promise((r) => setTimeout(r, 50));

      resolveApproval('HITL-001', 'REJECT', 'TEST-001');

      const decision = await decisionPromise;
      expect(decision).toBe('REJECT');
    });

    it('should return default on webhook failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      const handler = createDiscordApprovalHandler({
        webhookUrl: 'https://discord.com/api/webhooks/invalid/invalid',
      });

      const req = makeRequest();
      const decision = await handler(req);
      expect(decision).toBe('REJECT'); // defaultOnTimeout
    });

    it('should handle network errors gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const handler = createDiscordApprovalHandler({
        webhookUrl: 'https://discord.com/api/webhooks/test/test',
      });

      const req = makeRequest();
      const decision = await handler(req);
      expect(decision).toBe('REJECT');
    });

    it('should include buttons when gatewayBaseUrl is configured', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'msg-btn' }),
      });
      mockFetch.mockResolvedValueOnce({ ok: true });

      const handler = createDiscordApprovalHandler({
        webhookUrl: 'https://discord.com/api/webhooks/test/test',
        gatewayBaseUrl: 'http://localhost:3847',
      });

      const req = makeRequest({ gate: makeGate({ timeoutMs: 200 }) });
      await handler(req);

      const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(payload.components).toBeDefined();
      expect(payload.components[0].components).toHaveLength(2);
      expect(payload.components[0].components[0].label).toBe('APPROVE');
      expect(payload.components[0].components[1].label).toBe('REJECT');
    });

    it('should use CRITICAL severity for credential entry gate', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'msg-crit' }),
      });
      mockFetch.mockResolvedValueOnce({ ok: true });

      const handler = createDiscordApprovalHandler({
        webhookUrl: 'https://discord.com/api/webhooks/test/test',
      });

      const req = makeRequest({
        gate: makeGate({
          id: 'HITL-014',
          severity: 'CRITICAL',
          description: 'Computer Use credential entry',
          timeoutMs: 200,
        }),
      });

      await handler(req);

      const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
      // CRITICAL = red (0xff0000)
      expect(payload.embeds[0].color).toBe(0xff0000);
    });
  });
});
