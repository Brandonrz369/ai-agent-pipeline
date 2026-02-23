# Computer Use -- SUPERVISE Mode for GUI Tasks

**When there is no CLI, no API, and no scriptable interface, Claude Code can see the
screen, move the mouse, and press keys to complete GUI-dependent tasks.**

Computer Use is the tool of last resort. It is slower, more token-expensive, and
less reliable than programmatic alternatives. But some tasks -- installing desktop
applications, navigating GUI wizards, filling native forms -- have no programmatic
path. SUPERVISE mode exists for exactly these cases.

---

## Table of Contents

1. [What Computer Use Enables](#what-computer-use-enables)
2. [The Screenshot-Analyze-Act-Verify Loop](#the-screenshot-analyze-act-verify-loop)
3. [Context Offloading (Brain Damage Prevention)](#context-offloading-brain-damage-prevention)
4. [When NOT to Use Computer Use](#when-not-to-use-computer-use)
5. [Safety and HITL Gates](#safety-and-hitl-gates)
6. [Token Cost Model](#token-cost-model)
7. [Failure Modes and Recovery](#failure-modes-and-recovery)
8. [Configuration](#configuration)
9. [Cross-References](#cross-references)

---

## What Computer Use Enables

Computer Use grants Claude Code vision (screenshots) and motor control (mouse and
keyboard). This unlocks task categories that are impossible with text-only tools:

### Application Installation

- Download `.dmg`, `.exe`, `.deb`, or `.AppImage` files via browser
- Mount disk images and drag applications to `/Applications`
- Click through installer wizards (Next, Next, Accept License, Install)
- Handle macOS Gatekeeper prompts ("Allow app from unidentified developer")
- Verify successful installation by launching the application

### GUI Wizard Navigation

- Discord server setup (create channels, set permissions, configure bots)
- Slack workspace onboarding (invite members, configure integrations)
- IDE setup wizards (VS Code extensions, JetBrains configurations)
- Cloud provider consoles (when CLI is insufficient or unavailable)

### Native Form Filling

- PDF forms that require GUI interaction (not programmatically fillable)
- Desktop application settings dialogs
- System preferences and control panels
- Registration forms in native applications (not web forms)

### Visual State Monitoring

- Error dialog detection and response
- Loading spinner / progress bar monitoring
- Success/failure screen confirmation
- Multi-step wizard progress tracking

### Multi-Window Workflows

- Terminal + browser + application simultaneously
- Copy values between windows (e.g., copy auth token from browser to terminal)
- Drag-and-drop between applications
- Monitor one window while acting in another

---

## The Screenshot-Analyze-Act-Verify Loop

SUPERVISE mode operates on a continuous feedback loop. Each iteration:

```
┌──────────────────────────────────────────────────────┐
│                                                      │
│  Step 1: SCREENSHOT                                  │
│  ├─ Capture current desktop state                    │
│  ├─ Resolution: match display (typically 1920x1080)  │
│  └─ ~1500 tokens per screenshot                      │
│                                                      │
│  Step 2: ANALYZE                                     │
│  ├─ What do I see on screen?                         │
│  ├─ What is the current state of the task?           │
│  ├─ What is the next required action?                │
│  └─ Are there any unexpected dialogs/errors?         │
│                                                      │
│  Step 3: ACT                                         │
│  ├─ Move mouse to target coordinates (x, y)         │
│  ├─ Click (left/right/double)                        │
│  ├─ Type text string                                 │
│  ├─ Press key combination (Cmd+S, Enter, Tab, etc.)  │
│  └─ Scroll (up/down/left/right)                      │
│                                                      │
│  Step 4: VERIFY                                      │
│  ├─ Take new screenshot                              │
│  ├─ Did the action produce the expected change?      │
│  ├─ YES → Continue to next step                      │
│  ├─ NO  → Analyze what went wrong                    │
│  │        Try alternative approach                    │
│  └─ ERROR → Report to completion loop                │
│                                                      │
│  Step 5: CONTEXT CHECK (every 5 iterations)          │
│  ├─ Accumulated context approaching limit?           │
│  ├─ YES → Offload to Gemini MCP cache               │
│  └─ Continue with compressed summary                 │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### Action Types

| Action | Syntax | Example |
|--------|--------|---------|
| Move mouse | `mouse_move(x, y)` | `mouse_move(500, 300)` |
| Left click | `left_click(x, y)` | `left_click(500, 300)` |
| Right click | `right_click(x, y)` | `right_click(500, 300)` |
| Double click | `double_click(x, y)` | `double_click(500, 300)` |
| Type text | `type(text)` | `type("hello world")` |
| Press key | `key(combo)` | `key("cmd+s")` |
| Scroll | `scroll(direction, amount)` | `scroll("down", 3)` |
| Drag | `drag(x1, y1, x2, y2)` | `drag(100, 100, 500, 500)` |
| Wait | `wait(seconds)` | `wait(2)` |

### Screenshot Timing

Screenshots are taken:
- Before the first action (establish baseline)
- After every action (verify result)
- After waiting for a loading state to resolve
- When requesting context offload (capture current state for summary)

---

## Context Offloading (Brain Damage Prevention)

### The Problem

Each screenshot consumes ~1500 tokens. A 20-step GUI task generates 40+ screenshots
(before + after each action), consuming ~60,000 tokens of context. At this scale:

1. Claude Code's context window fills with stale screenshot data
2. Early task instructions get pushed out of effective attention
3. The agent "forgets" what it was doing -- "brain damage"
4. Actions become increasingly erratic and error-prone

### The Solution: Gemini MCP Cache

Every 5 steps (configurable), Claude Code offloads accumulated context:

```
Step 1-5: Normal operation, screenshots accumulate
Step 5: Offload checkpoint
  │
  ├─ Claude Code calls store_context(key, context) via Gemini MCP
  │   └─ context = {
  │       "task": "Install Discord on macOS",
  │       "completed_steps": ["Downloaded DMG", "Mounted disk image",
  │                           "Dragged to Applications", "Ejected DMG",
  │                           "Launched Discord"],
  │       "current_state": "Discord login screen displayed",
  │       "remaining_steps": ["Enter credentials", "Complete 2FA",
  │                           "Join target server", "Verify access"],
  │       "screenshots": [last_screenshot_only]
  │   }
  │
  ├─ Flash-Lite compresses to ~200 tokens:
  │   "Discord installed on macOS. Currently at login screen.
  │    Remaining: enter credentials, complete 2FA, join server, verify."
  │
  ├─ Claude Code calls get_summary(key) → receives compressed summary
  │
  └─ Claude Code continues with:
      - Current screenshot (fresh)
      - Compressed summary (200 tokens, not 30,000)
      - Task instructions (original prompt)
      - Safety constraints

Step 6-10: Normal operation with compressed history
Step 10: Next offload checkpoint
  ...
```

### MCP Tools for Context Offloading

| Tool | Parameters | Description |
|------|-----------|-------------|
| `store_context` | `key: string, context: object` | Send accumulated context to Gemini MCP cache |
| `get_summary` | `key: string` | Retrieve compressed summary from Gemini MCP cache |

### Configuration

```yaml
# In config/mcp-servers.yaml
gemini-cache:
  offload_interval: 5        # Steps between offloads
  max_context_tokens: 50000  # Target ceiling for Claude Code context
  compression_target: 200    # Token target for compressed summary
  model: "gemini-flash-lite" # Model used for compression
```

---

## When NOT to Use Computer Use

Computer Use is the fallback, not the default. It is 10-100x slower and 5-50x more
expensive than programmatic alternatives. Before entering SUPERVISE mode, Gemini
checks whether a non-GUI path exists.

### Decision Matrix

| Task Type | Preferred Approach | Use Computer Use? |
|-----------|-------------------|-------------------|
| Web automation | Browser CDP (Puppeteer, Playwright) via Bash | **No** -- 10x faster, deterministic |
| File operations | Claude Code's Bash/Read/Write/Edit tools | **No** -- instant, reliable |
| Terminal commands | Normal shell execution via Bash tool | **No** -- native capability |
| API interactions | HTTP requests via Bash (curl) or MCP tools | **No** -- direct and fast |
| Package installation | `apt`, `brew`, `npm`, `pip` via Bash | **No** -- CLI exists |
| Git operations | `git` commands via Bash | **No** -- CLI is definitive |
| Database queries | SQL client via Bash or MCP | **No** -- CLI or API available |
| Web form filling | Playwright/CDP via Bash | **No** -- scriptable |
| **Native app installation** | No CLI alternative for GUI installers | **Yes** |
| **GUI wizard navigation** | No scriptable interface | **Yes** |
| **Native form filling** | Not programmatically accessible | **Yes** |
| **Visual verification** | Must confirm visual state | **Yes** |
| **Desktop drag-and-drop** | No CLI equivalent | **Yes** |

### The Rule

> **If there is a CLI, API, or scriptable interface for the task, use that instead.
> Computer Use is the path of last resort when no programmatic alternative exists.**

Gemini enforces this rule during task classification. If a task can be accomplished
via Bash, MCP, or direct API calls, Gemini will NOT format a SUPERVISE prompt.

---

## Safety and HITL Gates

Computer Use carries elevated risk because it interacts with the full desktop
environment. The safety model adds two HITL gates on top of the standard pipeline
security (Phase 6).

### HITL-013: Computer Use Session Start

| Attribute | Value |
|-----------|-------|
| Gate ID | HITL-013 |
| Trigger | Any SUPERVISE mode session initiation |
| Severity | HIGH |
| Approval Channel | Discord #approvals or Telegram |
| Timeout | 30 minutes |
| Default on Timeout | BLOCK |

Before Claude Code can enter Computer Use mode, the operator must approve.
The approval request includes:
- Task description
- Expected GUI interactions
- Estimated duration
- Safety constraints that will be applied

### HITL-014: Credential Entry

| Attribute | Value |
|-----------|-------|
| Gate ID | HITL-014 |
| Trigger | Any password, API key, or credential input during Computer Use |
| Severity | CRITICAL |
| Approval Channel | Discord #approvals + push notification |
| Timeout | 15 minutes |
| Default on Timeout | BLOCK |

When Computer Use needs to enter credentials:
1. Claude Code pauses and requests HITL-014 approval
2. Operator reviews the credential request and target field
3. Operator can: approve (Claude types the credential), inject (operator types it
   manually while Claude waits), or reject (task fails gracefully)

**Credentials are NEVER stored in Claude Code's context or logs.** If the operator
chooses "inject," they type the credential directly while Claude Code's screenshot
capture is paused.

### Additional Safety Measures

| Measure | Description |
|---------|-------------|
| **URL Allowlist** | Browser navigation restricted to approved domains |
| **Payment Page Block** | Any page with payment forms triggers emergency stop |
| **Screenshot Audit Trail** | Every screenshot saved to `~/.openclaw/audit/screenshots/` |
| **Action Log** | Every mouse/keyboard action logged with timestamp and coordinates |
| **Emergency Stop** | Operator can send STOP command to immediately terminate session |
| **Restricted Desktop** | Computer Use sessions run in an isolated desktop environment when possible |

### Emergency Stop Protocol

The operator can terminate any Computer Use session immediately:

```
Telegram: Send "STOP" or "EMERGENCY" to the bot
Discord: React with the stop emoji or type /stop
Happy Coder: Tap the emergency stop button
```

On emergency stop:
1. All mouse/keyboard actions cease immediately
2. Final screenshot captured for audit
3. Session terminated
4. Task dead-lettered with reason "OPERATOR_EMERGENCY_STOP"
5. Full action log preserved in dead-letter record

---

## Token Cost Model

Computer Use is the most token-expensive operation in the pipeline. Understanding
the cost model helps with budgeting and deciding when Computer Use is justified.

### Per-Step Costs

| Component | Tokens | Cost (approximate) |
|-----------|--------|-------------------|
| Screenshot capture | ~1,500 | ~$0.02 |
| Analysis (interpret screenshot) | ~500 | ~$0.007 |
| Action decision | ~200 | ~$0.003 |
| Action execution | ~100 | ~$0.001 |
| Verification screenshot | ~1,500 | ~$0.02 |
| **Total per step** | **~3,800** | **~$0.05** |

### Per-Task Costs

| Task Complexity | Steps | Tokens | Cost |
|----------------|-------|--------|------|
| Simple (click 3 buttons) | 3-5 | ~15,000 | ~$0.20 |
| Medium (install app + configure) | 10-15 | ~50,000 | ~$0.70 |
| Complex (multi-app wizard + auth) | 20-30 | ~100,000 | ~$1.50 |

### Comparison with Programmatic Alternatives

| Approach | Time | Cost | Reliability |
|----------|------|------|------------|
| Bash command | <1 sec | ~$0.001 | 99%+ |
| API call | 1-5 sec | ~$0.005 | 95%+ |
| Browser CDP (Playwright) | 5-30 sec | ~$0.01 | 90%+ |
| Computer Use | 30-300 sec | ~$0.20-1.50 | 70-85% |

This cost differential is why Computer Use is the last resort.

---

## Failure Modes and Recovery

### Common Failure Modes

| Failure Mode | Symptom | Recovery |
|-------------|---------|----------|
| **Misclick** | Action hit wrong UI element | Take screenshot, identify correct target, retry |
| **Stale screenshot** | UI changed between screenshot and action | Wait 1 second, take fresh screenshot, re-analyze |
| **Unexpected dialog** | Modal popup blocks intended action | Analyze dialog, dismiss or respond appropriately |
| **Loading timeout** | Element not yet rendered | Wait with increasing backoff (1s, 2s, 4s), retry screenshot |
| **Resolution mismatch** | Coordinates off due to scaling | Recalibrate by identifying known UI landmarks |
| **Application crash** | Target app becomes unresponsive | Report error, attempt to relaunch, escalate if persists |
| **Wrong window focus** | Action goes to background window | Click on target window first, then retry action |

### Recovery Hierarchy

```
Failure detected
  │
  ├─ Retry same action (1 attempt)
  │   └─ Success? Continue
  │
  ├─ Try alternative approach (different click target, keyboard shortcut)
  │   └─ Success? Continue
  │
  ├─ Wait and retry (UI may be loading)
  │   └─ Success? Continue
  │
  ├─ Report "stuck" to completion loop
  │   └─ Gemini switches to ARCHITECT for new GUI approach
  │
  └─ Dead-letter (TTL exceeded)
      └─ Operator notified with full screenshot history
```

### Stuck Detection

Claude Code reports "stuck" when:
- Same screenshot state persists across 3 consecutive action attempts
- No visible change in UI after action execution
- Circular pattern detected (clicking the same elements repeatedly)

On "stuck" report, the completion loop escalates to ARCHITECT mode. The architect
receives the last 3 screenshots and action log, and produces a new approach to
the GUI task (e.g., "try the keyboard shortcut instead of the menu" or "the button
is behind a scroll area, scroll down first").

---

## Configuration

### SUPERVISE Mode Settings

```yaml
# In config/openclaw-config.yaml
supervise:
  enabled: true
  display_resolution: "1920x1080"
  screenshot_format: "png"
  screenshot_quality: 85
  max_steps_per_session: 50
  context_offload_interval: 5
  action_delay_ms: 500          # Pause between actions for UI to settle
  loading_timeout_ms: 10000     # Max wait for loading states
  stuck_threshold: 3            # Same state count before reporting stuck
  audit_screenshots: true
  audit_dir: "~/.openclaw/audit/screenshots/"
  url_allowlist:
    - "discord.com"
    - "slack.com"
    - "github.com"
    - "accounts.google.com"
  payment_page_patterns:
    - "checkout"
    - "payment"
    - "billing"
    - "purchase"
    - "subscribe"
```

### MCP Server Configuration for Context Offloading

```yaml
# In config/mcp-servers.yaml
servers:
  gemini-cache:
    command: "gemini-mcp-server"
    args: ["--mode", "cache"]
    env:
      GEMINI_API_KEY: "${GEMINI_API_KEY}"
    tools:
      - store_context
      - get_summary
    config:
      offload_interval: 5
      max_context_tokens: 50000
      compression_target: 200
      compression_model: "gemini-flash-lite"
```

---

## Cross-References

| Document | Relevance |
|----------|-----------|
| `docs/prompt-modes.md` | SUPERVISE mode definition and transition rules |
| `docs/completion-loop.md` | How GUI tasks flow through the completion loop |
| `docs/anti-loop-safeguards.md` | TTL and stuck detection for GUI tasks |
| `docs/openclaw-gateway.md` | How GUI tasks enter the pipeline |
| `docs/mobile-access.md` | Remote approval for HITL-013/014 gates |
| `security/hitl-gates.md` | HITL gate definitions (HITL-013, HITL-014) |
| `security/threat-model.md` | Threat model section 3.8 -- Computer Use risks |
| `docs/phase6-security.md` | Security framework governing Computer Use |
| `config/openclaw-config.yaml` | SUPERVISE mode configuration |
| `config/mcp-servers.yaml` | Gemini MCP cache configuration for context offloading |
