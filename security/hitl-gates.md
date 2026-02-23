# Human-in-the-Loop (HITL) Gate Definitions
## Version 1.0 -- February 2026
## Classification: Internal -- Security Documentation

---

## 1. OVERVIEW

### 1.1 Why HITL Gates Exist

HITL gates are mandatory human approval checkpoints placed before irreversible or
high-consequence actions in the pipeline. They exist because:

1. **Irreversibility**: Some actions cannot be undone (git push to remote, sending
   external communications, production deployments, data deletion).
2. **Blast radius**: Errors in these actions affect systems outside the pipeline's
   control boundary (external repositories, recipients, production environments).
3. **AI judgment limits**: LLMs are statistically confident, not actually certain.
   High-stakes decisions should not be delegated to probabilistic systems alone.
4. **Audit requirements**: Human sign-off creates a clear chain of responsibility
   and a legal/organizational paper trail.

### 1.2 Design Principle

**Default: block.** If a HITL gate times out without human response, the action is
blocked. The pipeline halts at that gate rather than proceeding unsupervised.

This is the inverse of most automation systems (which default to proceeding). The
default-block design reflects the GTG-1002 lesson: unsupervised agent action is
the primary risk vector.

---

## 2. GATE DEFINITIONS

### 2.1 Gate Registry (Table)

| Gate ID | Trigger Pattern | Severity | Approval Channel | Timeout | Default on Timeout |
|---------|----------------|----------|-----------------|---------|-------------------|
| HITL-001 | `git push` | HIGH | Discord #approvals | 30 min | BLOCK |
| HITL-002 | `send email` | HIGH | Discord #approvals | 30 min | BLOCK |
| HITL-003 | `deploy to production` | CRITICAL | Discord #approvals + SMS | 60 min | BLOCK |
| HITL-004 | `delete *` / `rm -rf` | CRITICAL | Discord #approvals | 15 min | BLOCK |
| HITL-005 | `drop table` / `truncate` | CRITICAL | Discord #approvals | 15 min | BLOCK |
| HITL-006 | Write to `external/` | HIGH | Discord #approvals | 30 min | BLOCK |
| HITL-007 | Write to `outbox/` | HIGH | Discord #approvals | 30 min | BLOCK |
| HITL-008 | Status transition: DRAFT to FINAL | MEDIUM | Discord #approvals | 60 min | BLOCK |
| HITL-009 | Status transition: STAGED to PROD | CRITICAL | Discord #approvals + SMS | 60 min | BLOCK |
| HITL-010 | MCP server image update | HIGH | Discord #approvals | 120 min | BLOCK |
| HITL-011 | RBAC scope expansion request | MEDIUM | Discord #approvals | 60 min | BLOCK |
| HITL-012 | Batch retry after 2 consecutive failures | MEDIUM | Discord #approvals | 60 min | BLOCK |
| HITL-013 | Computer Use session start | HIGH | Discord #approvals | 30 min | BLOCK |
| HITL-014 | Computer Use credential entry | CRITICAL | Discord #approvals + SMS | 15 min | BLOCK |

### 2.2 Gate Severity Levels

| Severity | Description | Notification | Escalation |
|----------|-------------|-------------|------------|
| MEDIUM | Controllable risk; error is recoverable | Discord message | After timeout, log and block |
| HIGH | Significant risk; error may require manual recovery | Discord message + mention | After timeout, block + page on-call |
| CRITICAL | Irreversible impact; production/external systems affected | Discord + SMS + mention | Immediate page; block indefinitely until human responds |

---

## 3. APPROVAL WORKFLOW

### 3.1 Step-by-Step Flow

```
Agent reaches HITL trigger
    |
    v
[STEP 1] N8n detects trigger pattern in task or command
    |
    v
[STEP 2] N8n PAUSES the workflow execution
    |     (sub-workflow enters WAITING state)
    |     (no further agent actions proceed)
    |
    v
[STEP 3] N8n sends Discord notification to #approvals channel
    |     (includes full context: node, task, action, risk level)
    |
    v
[STEP 4] Human reviews the notification
    |     |
    |     +---> APPROVE (react with checkmark or reply "approve")
    |     |         |
    |     |         v
    |     |     N8n resumes workflow. Action proceeds.
    |     |     Audit log: "HITL-XXX APPROVED by [human] at [timestamp]"
    |     |
    |     +---> REJECT (react with X or reply "reject")
    |     |         |
    |     |         v
    |     |     N8n blocks the action. Agent receives BLOCKED status.
    |     |     Audit log: "HITL-XXX REJECTED by [human] at [timestamp]"
    |     |     Agent writes failure report. Pipeline continues to next task.
    |     |
    |     +---> NO RESPONSE (timeout expires)
    |               |
    |               v
    |           Default action: BLOCK (see timeout behavior below)
    |           Audit log: "HITL-XXX TIMEOUT at [timestamp], default: BLOCK"
    |           Discord alert: "HITL gate timed out. Action blocked."
    |
    v
[STEP 5] Pipeline continues (approved) or halts at this gate (blocked)
```

### 3.2 N8n Implementation

```javascript
// N8n HITL Gate Sub-Workflow
// Trigger: called by main workflow when HITL pattern detected

// Step 1: Build notification payload
const payload = {
  gate_id: $json.gate_id,               // "HITL-001"
  node: $json.node_id,                  // 2
  task_id: $json.task_id,               // "PROJ-2026-001-B1-N2"
  action: $json.triggered_action,       // "git push origin main"
  severity: $json.severity,             // "HIGH"
  context: $json.action_context,        // "Pushing 3 files: src/auth/middleware.ts..."
  timestamp: new Date().toISOString(),
  timeout_minutes: $json.timeout,       // 30
  default_on_timeout: "BLOCK"
};

// Step 2: Send Discord notification
// (handled by Discord Webhook node)

// Step 3: Wait for response
// (N8n Wait node with timeout configured per gate)

// Step 4: Process response
if ($json.response === "approve") {
  return { action: "RESUME", approved_by: $json.responder };
} else if ($json.response === "reject") {
  return { action: "BLOCK", rejected_by: $json.responder, reason: $json.reason };
} else {
  // Timeout
  return { action: "BLOCK", reason: "TIMEOUT" };
}
```

---

## 4. NOTIFICATION FORMAT

### 4.1 Discord Message Template

All HITL notifications follow a consistent format so the human operator can make
a fast, informed decision.

```
--------------------------------------------------
HITL APPROVAL REQUIRED
--------------------------------------------------
Gate:       HITL-001 (git push)
Severity:   HIGH
Node:       Node 2 (Worker - module2)
Task:       PROJ-2026-001-B1-N2
Batch:      1
--------------------------------------------------
ACTION REQUESTED:
  git push origin main

CONTEXT:
  Files staged for push:
    - src/module2/auth/middleware.ts (modified)
    - tests/module2/auth/middleware.test.ts (new)
    - reports/n2_auth_middleware_batch1.md (new)

  Last commit message:
    "Batch 1 PROJ-2026-001-B1-N2: Implement JWT validation middleware -- Status: PASS"

  Tests: 14/14 passing
  Red Team: Not yet reviewed (pre-push gate)
--------------------------------------------------
RISK ASSESSMENT:
  Pushes to remote repository. Cannot be undone without
  force-push. Affects all collaborators pulling from main.
--------------------------------------------------
RESPOND:
  Reply "approve" to proceed
  Reply "reject [reason]" to block
  Timeout: 30 minutes (default: BLOCK)
--------------------------------------------------
```

### 4.2 Discord Webhook Payload

```json
{
  "content": "@here HITL approval required",
  "embeds": [{
    "title": "HITL-001: git push",
    "color": 15158332,
    "fields": [
      { "name": "Severity", "value": "HIGH", "inline": true },
      { "name": "Node", "value": "Node 2 (Worker)", "inline": true },
      { "name": "Task", "value": "PROJ-2026-001-B1-N2", "inline": true },
      { "name": "Action", "value": "`git push origin main`", "inline": false },
      { "name": "Context", "value": "3 files: middleware.ts, test, report", "inline": false },
      { "name": "Timeout", "value": "30 min (default: BLOCK)", "inline": true }
    ],
    "timestamp": "2026-02-22T10:30:00Z"
  }]
}
```

---

## 5. TIMEOUT BEHAVIOR

### 5.1 Default: Block

When a HITL gate times out without a human response, the default action is **BLOCK**.
The agent receives a BLOCKED status and writes a report indicating it was halted at
the HITL gate.

```
Agent report on timeout:
  status: BLOCKED
  blocked_reason: "HITL gate HITL-001 timed out after 30 minutes. Action: git push. Default: BLOCK."
  recommendation: "Human review required to proceed."
```

### 5.2 Timeout Escalation

| Severity | On Timeout | Escalation Action |
|----------|-----------|------------------|
| MEDIUM | Block + log | Discord reminder at T-5 minutes |
| HIGH | Block + alert | Discord reminder at T-10 minutes + mention @on-call |
| CRITICAL | Block + page | Discord reminder at T-15 minutes + SMS to on-call + halt batch |

### 5.3 Configurable Timeout per Gate

Timeouts are configurable in the HITL YAML configuration. Different gates have different
urgency levels. A production deploy gate may wait longer than a delete confirmation gate.

```yaml
# Per-gate timeout configuration
gates:
  HITL-001:
    timeout_minutes: 30
    reminder_at_minutes: 20     # Send reminder 10 min before timeout
    escalation: "discord_mention"
  HITL-003:
    timeout_minutes: 60
    reminder_at_minutes: 45
    escalation: "sms"
  HITL-004:
    timeout_minutes: 15
    reminder_at_minutes: 10
    escalation: "discord_mention"
```

---

## 6. OVERRIDE PROCEDURES

### 6.1 Emergency Bypass

In rare cases, a human operator may need to pre-approve actions that would normally
require HITL gates (e.g., during a time-sensitive batch where the operator will be
unavailable).

**Emergency bypass procedure:**

```bash
# Step 1: Log the override decision
OVERRIDE_GATES="HITL-001,HITL-008"
OVERRIDE_REASON="Operator unavailable 14:00-16:00, batch must complete by 15:30"
OVERRIDE_EXPIRY=$(date -u -d "+2 hours" +"%Y-%m-%dT%H:%M:%SZ")
OVERRIDE_BATCH="batch3"

log_action \
  "HITL_OVERRIDE: gates=$OVERRIDE_GATES reason='$OVERRIDE_REASON' expires=$OVERRIDE_EXPIRY batch=$OVERRIDE_BATCH" \
  "human" \
  "OVERRIDE"

# Step 2: Update the HITL config for the specific batch
# (N8n reads this on each gate check)
```

```yaml
# hitl-overrides.yaml (temporary, batch-scoped)
overrides:
  - gates: ["HITL-001", "HITL-008"]
    batch: "batch3"
    approved_by: "brandon"
    reason: "Operator unavailable 14:00-16:00"
    expires: "2026-02-22T18:00:00Z"
    audit_entry: "OVERRIDE-2026-02-22-001"
```

**Constraints on overrides:**
- CRITICAL severity gates (HITL-003, HITL-004, HITL-005, HITL-009) **cannot** be
  overridden. These always require real-time human approval.
- Overrides expire automatically. The `expires` field is mandatory.
- Overrides are batch-scoped. They do not carry over to subsequent batches.
- Every override is logged in the audit trail with the human's identity and reason.

### 6.2 Post-Override Review

After any batch that used HITL overrides, a mandatory review must occur:

1. Human reviews all actions that were auto-approved via override
2. Audit log entries for overridden gates are flagged for review
3. Any issues found trigger a rollback procedure
4. The override YAML file is deleted after review to prevent stale overrides

---

## 7. AUTO-APPROVED ACTIONS

Not every action needs human approval. The following actions are explicitly marked as
safe and skip HITL gates entirely. This keeps the pipeline flowing for routine work
while still catching high-risk operations.

### 7.1 Auto-Approved Action List

```yaml
auto_approved:
  # File reads (no side effects)
  - pattern: "read *"
    reason: "Read operations have no side effects"

  # Writing reports (expected agent output)
  - pattern: "write reports/*"
    reason: "Report generation is the primary agent output path"

  # Writing task files (orchestrator's core function)
  - pattern: "write prompts/*"
    reason: "Task dispatch is the orchestrator's designated output"

  # Local git operations (not push)
  - pattern: "git add && git commit"
    reason: "Local commits are reversible and part of the audit trail"

  # Scoped test execution
  - pattern: "npm test"
    reason: "Test execution within sandbox has no external side effects"

  # Schema validation
  - pattern: "npx ajv validate"
    reason: "Validation is a read-only check"

  # Cache queries (read-only)
  - pattern: "cache query *"
    reason: "Cache reads have no side effects"

  # Lint / format checks
  - pattern: "npx eslint *"
    reason: "Linting is a read-only analysis"
  - pattern: "npx prettier --check *"
    reason: "Format checking is read-only"
```

### 7.2 Rationale for Auto-Approval

An action qualifies for auto-approval if ALL of the following are true:
1. It has no side effects outside the pipeline's local environment
2. It is reversible (can be undone via git revert or file restore)
3. It does not transmit data to any external system
4. It does not modify production state
5. It operates within the agent's RBAC-granted scope

If any condition is not met, the action requires a HITL gate.

---

## 8. YAML CONFIGURATION (FULL)

### 8.1 Complete hitl-gates.yaml

```yaml
# hitl-gates.yaml
# Defines all Human-in-the-Loop gates for the AI Agent Pipeline
# Read by N8n on each workflow execution

version: "1.0"
default_action: "block"    # What happens on timeout: block or approve
notification_channel: "discord"
notification_webhook: "${DISCORD_WEBHOOK_URL}"

gates:
  HITL-001:
    name: "Git Push"
    trigger_pattern: "git push"
    severity: "HIGH"
    timeout_minutes: 30
    default_on_timeout: "block"
    notification:
      channel: "discord"
      mention: "@here"
      reminder_at_minutes: 20
    context_fields:
      - "files_staged"
      - "commit_message"
      - "target_branch"
      - "test_results"

  HITL-002:
    name: "Send Email"
    trigger_pattern: "send email"
    severity: "HIGH"
    timeout_minutes: 30
    default_on_timeout: "block"
    notification:
      channel: "discord"
      mention: "@here"
      reminder_at_minutes: 20
    context_fields:
      - "recipient"
      - "subject"
      - "body_preview"

  HITL-003:
    name: "Production Deploy"
    trigger_pattern: "deploy to production"
    severity: "CRITICAL"
    timeout_minutes: 60
    default_on_timeout: "block"
    override_allowed: false    # Cannot be bypassed
    notification:
      channel: "discord"
      mention: "@here"
      sms: true
      reminder_at_minutes: 45
    context_fields:
      - "deploy_target"
      - "version"
      - "changelog"
      - "test_results"
      - "red_team_status"

  HITL-004:
    name: "Destructive Delete"
    trigger_pattern: "delete *"
    alternate_patterns:
      - "rm -rf"
      - "rm -r"
      - "unlink"
    severity: "CRITICAL"
    timeout_minutes: 15
    default_on_timeout: "block"
    override_allowed: false
    notification:
      channel: "discord"
      mention: "@here"
      reminder_at_minutes: 10
    context_fields:
      - "target_path"
      - "file_count"
      - "size_estimate"

  HITL-005:
    name: "Database Destructive"
    trigger_pattern: "drop table"
    alternate_patterns:
      - "truncate"
      - "DELETE FROM"
    severity: "CRITICAL"
    timeout_minutes: 15
    default_on_timeout: "block"
    override_allowed: false
    notification:
      channel: "discord"
      mention: "@here"
      reminder_at_minutes: 10
    context_fields:
      - "target_table"
      - "row_count"
      - "has_backup"

  HITL-006:
    name: "External File Write"
    trigger_pattern: "write external/*"
    severity: "HIGH"
    timeout_minutes: 30
    default_on_timeout: "block"
    notification:
      channel: "discord"
      mention: "@here"
      reminder_at_minutes: 20
    context_fields:
      - "target_path"
      - "content_preview"
      - "destination_system"

  HITL-007:
    name: "Outbox Write"
    trigger_pattern: "write outbox/*"
    severity: "HIGH"
    timeout_minutes: 30
    default_on_timeout: "block"
    notification:
      channel: "discord"
      mention: "@here"
      reminder_at_minutes: 20
    context_fields:
      - "target_path"
      - "content_preview"
      - "recipient"

  HITL-008:
    name: "Status to Final"
    trigger_pattern: "status_transition"
    trigger_value: "DRAFT->FINAL"
    severity: "MEDIUM"
    timeout_minutes: 60
    default_on_timeout: "block"
    notification:
      channel: "discord"
      reminder_at_minutes: 50
    context_fields:
      - "document"
      - "red_team_review"
      - "change_summary"

  HITL-009:
    name: "Status to Production"
    trigger_pattern: "status_transition"
    trigger_value: "STAGED->PROD"
    severity: "CRITICAL"
    timeout_minutes: 60
    default_on_timeout: "block"
    override_allowed: false
    notification:
      channel: "discord"
      mention: "@here"
      sms: true
      reminder_at_minutes: 45
    context_fields:
      - "deployment_manifest"
      - "test_results"
      - "red_team_status"
      - "rollback_plan"

  HITL-010:
    name: "MCP Server Update"
    trigger_pattern: "mcp_server_update"
    severity: "HIGH"
    timeout_minutes: 120
    default_on_timeout: "block"
    notification:
      channel: "discord"
      mention: "@here"
      reminder_at_minutes: 90
    context_fields:
      - "server_name"
      - "old_digest"
      - "new_digest"
      - "changelog"

  HITL-011:
    name: "RBAC Scope Expansion"
    trigger_pattern: "rbac_expansion"
    severity: "MEDIUM"
    timeout_minutes: 60
    default_on_timeout: "block"
    notification:
      channel: "discord"
      reminder_at_minutes: 50
    context_fields:
      - "requesting_node"
      - "requested_resource"
      - "reason"
      - "duration"

  HITL-012:
    name: "Batch Retry After Failures"
    trigger_pattern: "batch_retry"
    trigger_condition: "consecutive_failures >= 2"
    severity: "MEDIUM"
    timeout_minutes: 60
    default_on_timeout: "block"
    notification:
      channel: "discord"
      reminder_at_minutes: 50
    context_fields:
      - "batch_id"
      - "failure_count"
      - "failure_reasons"
      - "estimated_cost"

  HITL-013:
    name: "Computer Use Session"
    trigger_pattern: "computer_use_start"
    trigger_condition: "mode == SUPERVISE"
    severity: "HIGH"
    timeout_minutes: 30
    default_on_timeout: "block"
    notification:
      channel: "discord"
      mention: "@here"
      reminder_at_minutes: 20
    context_fields:
      - "task_id"
      - "target_application"
      - "task_objective"
      - "url_allowlist"
      - "estimated_actions"
    notes: |
      Required before any Computer Use session starts. The operator must verify
      the target application, URL allowlist, and task objective before granting
      Claude Code vision + mouse + keyboard access.

  HITL-014:
    name: "Computer Use Credential Entry"
    trigger_pattern: "credential_entry"
    trigger_condition: "mode == SUPERVISE AND action_type == credential_input"
    severity: "CRITICAL"
    timeout_minutes: 15
    default_on_timeout: "block"
    override_allowed: false
    notification:
      channel: "discord"
      mention: "@here"
      sms: true
      reminder_at_minutes: 10
    context_fields:
      - "task_id"
      - "target_site"
      - "credential_type"
      - "screenshot"
      - "url_verified"
    notes: |
      CRITICAL gate — no override allowed. Any time Claude Code in SUPERVISE mode
      needs to enter credentials (passwords, tokens, API keys), this gate fires.
      The operator MUST verify the target URL matches the expected site (not phishing)
      and that the credential type is appropriate for the task.

# Auto-approved actions (skip HITL entirely)
auto_approved:
  - pattern: "read *"
    reason: "Read operations have no side effects"
  - pattern: "write reports/*"
    reason: "Report generation is expected agent output"
  - pattern: "write prompts/*"
    reason: "Task dispatch is orchestrator's designated output"
  - pattern: "git add && git commit"
    reason: "Local commits are reversible and part of audit trail"
  - pattern: "npm test"
    reason: "Test execution in sandbox has no external side effects"
  - pattern: "npx ajv validate"
    reason: "Schema validation is read-only"
  - pattern: "cache query *"
    reason: "Cache reads have no side effects"
  - pattern: "npx eslint *"
    reason: "Linting is read-only analysis"
  - pattern: "npx prettier --check *"
    reason: "Format checking is read-only"
```

---

## 9. AUDIT INTEGRATION

Every HITL gate interaction is recorded in the cryptographic audit trail.

### 9.1 Audit Log Format

```
HITL events generate the following audit entries:

TRIGGERED:  2026-02-22T10:30:00Z | Node:2 | Task:PROJ-2026-001-B1-N2 | HITL-001:TRIGGERED action="git push origin main"
NOTIFIED:   2026-02-22T10:30:01Z | Node:2 | Task:PROJ-2026-001-B1-N2 | HITL-001:NOTIFIED channel=discord
APPROVED:   2026-02-22T10:35:22Z | Node:2 | Task:PROJ-2026-001-B1-N2 | HITL-001:APPROVED by=brandon
EXECUTED:   2026-02-22T10:35:23Z | Node:2 | Task:PROJ-2026-001-B1-N2 | HITL-001:EXECUTED result=success

-- or --

REJECTED:   2026-02-22T10:35:22Z | Node:2 | Task:PROJ-2026-001-B1-N2 | HITL-001:REJECTED by=brandon reason="Red team review not complete"
BLOCKED:    2026-02-22T10:35:23Z | Node:2 | Task:PROJ-2026-001-B1-N2 | HITL-001:BLOCKED

-- or --

TIMEOUT:    2026-02-22T11:00:00Z | Node:2 | Task:PROJ-2026-001-B1-N2 | HITL-001:TIMEOUT after=30min default=BLOCK
BLOCKED:    2026-02-22T11:00:01Z | Node:2 | Task:PROJ-2026-001-B1-N2 | HITL-001:BLOCKED
```

### 9.2 HMAC Signing

All HITL audit entries are HMAC-signed to prevent tampering:

```bash
log_hitl_action() {
  local gate="$1" event="$2" node="$3" task_id="$4" details="$5"
  local timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  local entry="$timestamp | Node:$node | Task:$task_id | $gate:$event $details"
  local signature=$(echo -n "$entry" | openssl dgst -sha256 -hmac "$AUDIT_SECRET" | awk '{print $2}')
  echo "$entry | Sig:$signature" >> audit.log
}

# Usage:
log_hitl_action "HITL-001" "APPROVED" "2" "PROJ-2026-001-B1-N2" "by=brandon"
```

---

## 10. TESTING HITL GATES

Before deploying the pipeline, verify all HITL gates function correctly.

### 10.1 Test Procedure

```bash
# 1. Trigger each gate with a test action
# (Use a dedicated test batch with dry_run: true)

# 2. Verify Discord notification arrives with correct format
# 3. Test APPROVE response -> verify workflow resumes
# 4. Test REJECT response -> verify workflow blocks
# 5. Test TIMEOUT -> verify default block + escalation
# 6. Verify audit log entries for each test
# 7. Test auto-approved actions -> verify they skip HITL

# Automated test script:
for gate_id in HITL-001 HITL-002 HITL-003 HITL-004 HITL-005; do
  echo "Testing $gate_id..."
  curl -X POST "$N8N_WEBHOOK_URL/test-hitl" \
    -H "Content-Type: application/json" \
    -d "{\"gate_id\": \"$gate_id\", \"test_mode\": true, \"node\": 0, \"task_id\": \"TEST-001\"}"
  echo "  -> Check Discord for notification"
  sleep 5
done
```

### 10.2 Annual HITL Review

All HITL gate definitions should be reviewed annually (or after any security incident) to:
- Verify gate coverage: are there new irreversible actions not covered by a gate?
- Review timeout values: are they appropriate for current team response times?
- Audit override history: were overrides used appropriately?
- Update notification channels: are the right people being notified?

---

*Document owner: Node 4 (Security Specialist)*
*Last updated: 2026-02-22*
*Next review: 2026-05-22*
