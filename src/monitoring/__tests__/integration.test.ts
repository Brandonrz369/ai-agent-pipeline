/**
 * Monitoring Integration Tests (T21 - Bravo)
 * Verifies ErrorMonitor is properly wired via source-level checks.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getMonitor, resetMonitor } from "../index.js";

vi.mock("../../utils/logger.js", () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../../audit/index.js", () => ({ logAuditEntry: vi.fn().mockResolvedValue({}) }));
vi.mock("../../anti-loop/dead-letter.js", () => ({ listDeadLetter: vi.fn().mockResolvedValue([]) }));
vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));

beforeEach(() => { vi.clearAllMocks(); resetMonitor(); });
afterEach(() => { resetMonitor(); });
describe("Source-level wiring verification", () => {
  it("loop-driver.ts has all monitoring calls wired", async () => {
    const src = (await import("node:fs")).readFileSync("src/orchestrator/loop-driver.ts","utf8");
    expect(src).toContain("getMonitor");
    expect(src).toContain("ttl_exceeded");
    expect(src).toContain("task_failure");
    expect(src).toContain("escalation");
    expect(src).toContain("dead_letter");
  });

  it("verifier/index.ts has monitoring wired", async () => {
    const src = (await import("node:fs")).readFileSync("src/verifier/index.ts","utf8");
    expect(src).toContain("getMonitor");
    expect(src).toContain("api_error");
    expect(src).toContain("parse_error");
  });
  it("webhook has /metrics and webhook_error wired", async () => {
    const src = (await import("node:fs")).readFileSync("src/gateway/webhook.ts","utf8");
    expect(src).toContain("getMonitor");
    expect(src).toContain("/metrics");
    expect(src).toContain("webhook_error");
  });

  it("cli.ts has unhandledRejection handler", async () => {
    const src = (await import("node:fs")).readFileSync("src/cli.ts","utf8");
    expect(src).toContain("unhandledRejection");
    expect(src).toContain("getMonitor");
  });
});

describe("GeminiVerifier → ErrorMonitor (unit)", () => {
  it("records api_error when generateContent throws", async () => {
    const monitor = getMonitor({ thresholds: [], alertCooldownMs: 0 });    vi.doMock("../../utils/antigravity-client.js", () => ({
      AntigravityClient: vi.fn().mockImplementation(() => ({
        generateContent: vi.fn().mockRejectedValue(new Error("Gemini 503")),
      })),
    }));
    const { GeminiVerifier } = await import("../../verifier/index.js");
    const verifier = new GeminiVerifier();
    const task: any = { task_id: "VER-001", task: { type: "CREATE", objective: "t", instructions: [] }, output: { report_file: "o.md" }, metadata: {}, constraints: {} };
    const result = await verifier.verify(task, { task_id: "VER-001", status: "FAIL", summary: "f" } as any);
    expect(result.verdict).toBe("RETRY");
    const errors = monitor.getRecentErrors({ component: "verifier" });
    expect(errors.some(e => e.errorType === "api_error")).toBe(true);
  });
});