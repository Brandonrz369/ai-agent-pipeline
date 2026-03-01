// ── Task Blueprint (mirrors schemas/task-blueprint.schema.json) ──

export type Priority = 'P1' | 'P2' | 'P3' | 'P4';
export type TaskType = 'EDIT' | 'CREATE' | 'REVIEW' | 'RESEARCH' | 'EXECUTE';
export type TaskStatus = 'PASS' | 'FAIL' | 'PARTIAL' | 'BLOCKED';
export type PromptMode = 'EXECUTE' | 'ARCHITECT' | 'SUPERVISE';
export type VerifierResult = 'PASS' | 'RETRY' | 'ESCALATE';
export type Severity = 'CRITICAL' | 'IMPORTANT' | 'MINOR';
export type Tier = 1 | 2 | 3;

export interface TaskMetadata {
  project: string;
  node: number;
  workstream: string;
  batch: number;
  priority: Priority;
  tier: Tier;
  deadline?: string;
}

export interface TaskDefinition {
  type: TaskType;
  target_file?: string;
  objective: string;
  instructions: string[];
  dependencies?: string[];
  mcp_tools_required?: string[];
  context_queries?: string[];
}

export interface TaskOutput {
  report_file: string;
  status_options: TaskStatus[];
  required_fields?: string[];
}

export interface TaskConstraints {
  write_scope?: string[];
  read_scope?: string[];
  forbidden?: string[];
  requires_human_approval?: boolean;
}

export interface TaskEnvelope {
  id: string;
  task_id_ref?: string;
  trace_id: string;
  ttl_max: number;
  hops: number;
  mode: PromptMode;
  state_hashes: string[];
  consecutive_failures: number;
  consecutive_successes: number;
  escalated: boolean;
  session_ids: string[];
  mcp_cache_key?: string;
  dead_letter_path?: string;
  created_at: string;
  last_hop_at?: string;
}

export interface TaskBlueprint {
  task_id: string;
  metadata: TaskMetadata;
  task: TaskDefinition;
  output: TaskOutput;
  constraints: TaskConstraints;
  envelope?: TaskEnvelope;
}

// ── Report (mirrors schemas/report.schema.json) ──

export interface FileChange {
  file: string;
  description: string;
}

export interface GeminiQuery {
  query: string;
  answer_summary: string;
}

export interface CrossStreamAlert {
  severity: Severity;
  file: string;
  description: string;
}

export interface WorkerReport {
  task_id: string;
  node: number;
  status: TaskStatus;
  timestamp: string;
  changes_made: FileChange[];
  gemini_queries?: GeminiQuery[];
  cross_stream_alerts?: CrossStreamAlert[];
  new_issues?: string[];
  blocked_on?: string;
}

// ── Routing Config (mirrors schemas/routing-config.schema.json) ──

export interface ModelConfig {
  provider: string;
  model_id: string;
  cost_per_1m_tokens: number;
}

export interface TierConfig {
  models: ModelConfig[];
  task_profiles: string[];
  max_retries: number;
}

export interface ClassifierRule {
  pattern: string;
  tier: Tier;
}

export interface RoutingConfig {
  tiers: {
    tier1: TierConfig;
    tier2: TierConfig;
    tier3: TierConfig;
  };
  classifier: {
    model: string;
    rules: ClassifierRule[];
  };
  fallback: {
    tier1_failure: { tier: 2 | 3 };
    tier2_failure: { tier: 3 };
    tier3_failure: { action: 'stop_and_alert' };
  };
  cost_limits: {
    daily_budget_usd: number;
    alert_threshold_percent: number;
  };
}

// ── Pipeline Config (parsed from config/openclaw-config.yaml) ──

export interface PipelineConfig {
  orchestrator: {
    model: string;
    api_key: string;
    role: string;
  };
  verifier: {
    model: string;
    api_key: string;
  };
  claude_code: {
    invocation: string;
    output_format: string;
    modes: Record<string, {
      template: string;
      allowed_tools: string[];
    }>;
  };
  anti_loop: {
    ttl_max: number;
    hysteresis: {
      failures_to_escalate: number;
      successes_to_deescalate: number;
    };
    backflow_detection: boolean;
    hash_algorithm: string;
  };
  registry?: {
    enabled: boolean;
    heartbeat_interval_ms: number;
    nodes: WorkerNode[];
  };
  dead_letter: {
    path: string;
    backend?: DeadLetterBackend;
    notification: {
      telegram: boolean;
      discord: boolean;
      channel: string;
    };
    retention_days: number;
  };
}

// ── Claude Code Executor Output ──

export interface ClaudeOutput {
  task_id: string;
  status: TaskStatus;
  report_file?: string;
  state_hash_post?: string;
  affected_files?: string[];
  summary: string;
  session_id?: string;
  cost_usd?: number;
  duration_ms?: number;
}

// ── Completion Loop State ──

export type LoopAction = 'CLASSIFY' | 'FORMAT' | 'EXECUTE' | 'VERIFY' | 'ANTI_LOOP' | 'DONE' | 'DEAD_LETTER';

export interface LoopState {
  task: TaskBlueprint;
  envelope: TaskEnvelope;
  currentAction: LoopAction;
  claudeOutput?: ClaudeOutput;
  verifierResult?: VerifierResult;
  error?: string;
}

// ── Brain Context MCP ──

export interface BrainContextEntry {
  key: string;
  summary: string;
  original_tokens: number;
  compressed_tokens: number;
  stored_at: string;
}

export interface BrainContextStore {
  entries: Record<string, BrainContextEntry>;
  total_entries: number;
  last_updated: string;
}

// ── Audit ──

export interface AuditEntry {
  timestamp: string;
  action: string;
  task_id?: string;
  node?: number;
  details: Record<string, unknown>;
  hmac: string;
}

export type SuperviseStatus = 'PASS' | 'FAIL' | 'STUCK';

export type ScreenshotActionType = 'screenshot' | 'click' | 'type' | 'scroll' | 'key' | 'move';

export interface ScreenshotAction {
  type: ScreenshotActionType;
  x?: number;
  y?: number;
  text?: string;
  key?: string;
  scroll?: { direction: 'up' | 'down' | 'left' | 'right'; amount: number };
  description: string;
}

export interface SuperviseResult {
  task_id: string;
  mode: 'SUPERVISE';
  status: SuperviseStatus;
  screenshots_taken: number;
  actions_performed: number;
  context_offloads: number;
  summary: string;
  issues: string[];
  mcp_cache_key?: string;
  duration_ms?: number;
}

export interface ComputerUseProvider {
  screenshot(): Promise<{ data: string; mimeType: string }>;
  moveMouse(x: number, y: number): Promise<void>;
  click(x: number, y: number, button?: 'left' | 'right' | 'middle'): Promise<void>;
  type(text: string): Promise<void>;
  pressKey(key: string): Promise<void>;
  scroll(x: number, y: number, direction: 'up' | 'down' | 'left' | 'right', amount: number): Promise<void>;
}

export interface SuperviseConfig {
  maxActions: number;
  contextOffloadEvery: number;
  urlAllowlist: string[];
  hitlApproved: boolean;
}

// ── Distributed Scaling (Phase 4) ──

export type NodeStatus = 'ONLINE' | 'OFFLINE' | 'BUSY' | 'MAINTENANCE';

export interface WorkerNode {
  id: string;
  hostname: string;
  ip: string;
  port: number;
  status: NodeStatus;
  capabilities: string[];
  last_seen: string;
  load_average: number;
}

export interface RegistryUpdate {
  node_id: string;
  status: NodeStatus;
  load_average?: number;
}

export type DeadLetterBackendType = 'LOCAL_FILE' | 'REDIS' | 'POSTGRES';

export interface DeadLetterBackend {
  type: DeadLetterBackendType;
  connection_string?: string;
  table_or_key_prefix?: string;
}
