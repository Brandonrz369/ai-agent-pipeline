# Mobile & Remote Access Patterns

**How to reach your pipeline from anywhere -- phone, tablet, laptop, or any device
with a browser or messaging app.**

The V3 architecture is designed to run on a home machine (or VPS) and be controlled
remotely. You should never need to sit in front of the machine to dispatch tasks,
approve HITL gates, or read results. This document covers every access pattern:
native app, secure networking, browser-based remote, and messaging channels.

---

## Table of Contents

1. [Access Method Summary](#access-method-summary)
2. [Happy Coder (Primary Mobile App)](#happy-coder-primary-mobile-app)
3. [Tailscale (Secure Networking)](#tailscale-secure-networking)
4. [Claude Code Remote (Browser-Based)](#claude-code-remote-browser-based)
5. [Telegram](#telegram)
6. [Discord](#discord)
7. [Cost Model](#cost-model)
8. [Choosing an Access Method](#choosing-an-access-method)
9. [Cross-References](#cross-references)

---

## Access Method Summary

| Method | Type | Best For | Setup Time | Requires |
|--------|------|----------|-----------|----------|
| Happy Coder | Native app | Primary daily use, streaming output | 15 min | Tailscale |
| Tailscale | VPN mesh | Secure networking for all methods | 10 min | Account (free) |
| Claude Code Remote | Browser | Quick access from any device | 5 min | Cloudflare Tunnel |
| Telegram | Messaging | Lightweight tasks, notifications, HITL | 10 min | Telegram account |
| Discord | Messaging | Team use, structured commands, HITL | 15 min | Discord server |

---

## Happy Coder (Primary Mobile App)

Happy Coder is the recommended primary interface for mobile pipeline control.

### Features

| Feature | Description |
|---------|-------------|
| **Native performance** | iOS and Android native app (not a web wrapper) |
| **End-to-end encryption** | All traffic encrypted between app and OpenClaw daemon |
| **Push notifications** | Task completion, failures, dead-letters, HITL approval requests |
| **Voice input** | Speak your task instead of typing (transcribed before dispatch) |
| **Real-time streaming** | Watch Claude Code's output as it executes in real time |
| **Task history** | Browse past tasks, results, and dead-letter records |
| **HITL approval** | Approve or reject HITL gates directly from notifications |
| **Dead-letter management** | Inspect, retry, or abandon dead-lettered tasks |

### Setup

1. Install Happy Coder from App Store / Google Play
2. Ensure Tailscale is running on both phone and home machine (see below)
3. In Happy Coder settings, enter your OpenClaw address: `http://openclaw.tailnet:3001`
4. Pair with QR code displayed by `openclaw pair`
5. Test with a simple task: "What time is it?"

### Architecture

```
Happy Coder (phone)
  │
  ├─ Tailscale VPN tunnel (encrypted, no port forwarding)
  │
  └─→ OpenClaw Gateway (home machine, port 3001)
        │
        └─→ Gemini → Claude Code → Flash-Lite → Result
              │
              └─→ Real-time streaming back to Happy Coder
```

### Push Notification Types

| Type | Priority | Content |
|------|----------|---------|
| Task complete | Normal | Task summary + status |
| Task failed (retrying) | Normal | Error summary + current hop count |
| Dead-letter | High | Task description + failure reason + retry button |
| HITL approval request | High | Action description + approve/reject buttons |
| Emergency (HITL-014) | Critical | Credential entry request + approve/inject/reject |

---

## Tailscale (Secure Networking)

Tailscale provides the secure networking layer that makes all other access methods
work from outside your home network.

### What Tailscale Does

| Capability | Description |
|-----------|-------------|
| **Mesh VPN** | Direct encrypted connections between your devices |
| **Zero port forwarding** | No router configuration needed |
| **NAT traversal** | Works through firewalls and carrier-grade NAT |
| **MagicDNS** | Access devices by name (e.g., `openclaw.tailnet`) |
| **ACLs** | Control which devices can reach which services |

### What Tailscale Replaces

Without Tailscale, you would need to:
- Open ports on your router (security risk)
- Configure dynamic DNS (fragile)
- Set up TLS certificates (maintenance burden)
- Use a VPN server (additional infrastructure)

Tailscale eliminates all of this with a 10-minute setup.

### Setup

```bash
# On home machine (where OpenClaw runs)
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --hostname=openclaw

# On phone
# Install Tailscale from App Store / Google Play
# Log in with same account
# OpenClaw is now reachable at openclaw.tailnet
```

### Security Model

- Only devices on YOUR Tailscale account can reach OpenClaw
- Traffic is encrypted end-to-end (WireGuard)
- No data passes through Tailscale's servers (direct peer-to-peer when possible)
- Free tier is sufficient for personal use (up to 100 devices)

### Tailscale + OpenClaw Configuration

```yaml
# In config/openclaw-config.yaml
network:
  tailscale:
    enabled: true
    hostname: "openclaw"
    # OpenClaw binds to 0.0.0.0 but is only reachable via Tailscale
    # unless you explicitly expose it on the local network
```

---

## Claude Code Remote (Browser-Based)

For situations where you do not want to install Happy Coder, or you are on a
device where it is not available, Claude Code Remote provides a browser-based
terminal interface.

### Features

| Feature | Description |
|---------|-------------|
| **Zero config** | Cloudflare Tunnel handles networking automatically |
| **QR code pairing** | Scan a code to connect from any device |
| **Any browser** | Works in Safari, Chrome, Firefox on any device |
| **Terminal interface** | Full Claude Code terminal experience in the browser |
| **No app install** | Nothing to install on the remote device |

### Setup

```bash
# On home machine
# Install cloudflared
brew install cloudflared  # macOS
# or
curl -fsSL https://pkg.cloudflare.com/install.sh | sh  # Linux

# Start a tunnel (one-time)
cloudflared tunnel --url http://localhost:3000

# Cloudflared outputs a URL like:
# https://abc123.trycloudflare.com
# This URL is your Claude Code Remote access point
```

### QR Code Pairing

```bash
# Generate a QR code for mobile pairing
openclaw remote-qr

# Displays a QR code in the terminal
# Scan with your phone camera to open in browser
```

### When to Use Claude Code Remote vs. Happy Coder

| Scenario | Recommended |
|----------|-------------|
| Daily mobile use with notifications | Happy Coder |
| Quick one-off task from any device | Claude Code Remote |
| Shared/borrowed device | Claude Code Remote (no install) |
| Need streaming output on mobile | Happy Coder (native performance) |
| Desktop browser on another machine | Claude Code Remote |
| HITL approvals on the go | Happy Coder (push notifications) |

---

## Telegram

Telegram integration turns the OpenClaw bot into a conversational interface for
the pipeline.

### Features

| Feature | Description |
|---------|-------------|
| **Task dispatch** | Send a message to dispatch a task |
| **Result delivery** | Receive results as bot replies |
| **Dead-letter notifications** | Get notified when tasks fail permanently |
| **HITL approval** | Approve/reject via reply or inline keyboard |
| **File sharing** | Send files as task context (images, documents) |
| **Group support** | Works in private DMs or group channels |

### Setup

1. Create a Telegram bot via @BotFather
2. Copy the bot token
3. Configure in `config/openclaw-config.yaml`:

```yaml
channels:
  telegram:
    enabled: true
    bot_token: "${TELEGRAM_BOT_TOKEN}"
    allowed_user_ids: [your_telegram_user_id]
```

4. Start OpenClaw: `openclaw start`
5. Send `/start` to your bot in Telegram

### Usage Examples

```
You: Set up a new Express API with TypeScript, add auth middleware and rate limiting

Bot: Task dispatched (task_abc123). Estimated: 3-5 minutes.
     Mode: EXECUTE | TTL: 10 | Sub-tasks: 3

Bot: [2 min later]
     Task complete (3/3 sub-tasks passed).
     - Created src/server.ts with Express + TypeScript
     - Added src/middleware/auth.ts (JWT validation)
     - Added src/middleware/rate-limit.ts (Redis sliding window)
     - All 14 tests passing
     Files: [View in Claude Code Remote]

You: /dead-letters

Bot: 1 pending dead-letter:
     task_def456 - "Configure Nginx reverse proxy"
     Reason: TTL_EXCEEDED (10 hops)
     Last error: "nginx.conf syntax error on line 42"
     [Retry] [Inspect] [Abandon]
```

### HITL Approval via Telegram

When a HITL gate fires:

```
Bot: HITL APPROVAL REQUIRED (HIGH)
     Gate: HITL-001 (git push)
     Action: git push origin main
     Repository: ai-agent-pipeline
     Branch: main
     Commits: 3 new commits

     Reply with:
     /approve - Allow the action
     /reject  - Block the action

You: /approve

Bot: HITL-001 approved. Action proceeding.
```

---

## Discord

Discord integration is similar to Telegram but optimized for team use with
role-based access, slash commands, and thread-based conversations.

### Features

| Feature | Description |
|---------|-------------|
| **Slash commands** | Structured task submission via `/task`, `/status`, `/dead-letters` |
| **Thread conversations** | Each task gets a thread for multi-turn interaction |
| **Role-based access** | Only users with approved roles can submit tasks |
| **Webhook notifications** | N8n can post directly to Discord channels |
| **Reaction-based HITL** | Approve/reject with emoji reactions |
| **Rich embeds** | Results formatted with code blocks, tables, and status indicators |

### Setup

1. Create a Discord bot at discord.com/developers
2. Add bot to your server with required permissions
3. Configure in `config/openclaw-config.yaml`:

```yaml
channels:
  discord:
    enabled: true
    bot_token: "${DISCORD_BOT_TOKEN}"
    guild_id: "your-guild-id"
    channel_id: "your-channel-id"
    allowed_role_ids: ["operator-role-id"]
```

4. Register slash commands: `openclaw discord register-commands`
5. Start OpenClaw: `openclaw start`

### Slash Commands

| Command | Description |
|---------|-------------|
| `/task <description>` | Submit a new task |
| `/status` | Show active tasks and their current state |
| `/status <task_id>` | Show detailed status of a specific task |
| `/dead-letters` | List pending dead-letters |
| `/retry <task_id>` | Retry a dead-lettered task |
| `/abandon <task_id>` | Abandon a dead-lettered task |
| `/stop <task_id>` | Emergency stop an active task |
| `/config` | Show current pipeline configuration |

### HITL Approval via Discord

```
#approvals channel:

[BOT] HITL APPROVAL REQUIRED
Gate: HITL-001 (git push)
Severity: HIGH
Action: git push origin main
Repository: ai-agent-pipeline

React: ✅ to approve | ❌ to reject

@operator reacted with ✅

[BOT] HITL-001 approved by @operator. Action proceeding.
```

---

## Cost Model

The V3 architecture shifts from variable API costs (V1/V2) to a subscription-based
model for Claude Code, with Gemini remaining variable but predictable.

### Monthly Cost Breakdown

| Component | Type | Monthly Cost | Notes |
|-----------|------|-------------|-------|
| Gemini 3.1 Pro | Variable | $50-60 | ~75 tasks/day orchestration (classify, format, parse, summarize) |
| Gemini Flash-Lite | Variable | $1-3 | Verification (~75/day) + MCP cache compression |
| Claude Sub (Pro) | Fixed | $20 | Light use: 10-20 tasks/day |
| Claude Sub (Max 5x) | Fixed | $100 | Moderate use: 30-50 tasks/day |
| Claude Sub (Max 20x) | Fixed | $200 | Heavy use: 75-100+ tasks/day |

### Total Monthly Cost by Usage Tier

| Usage Level | Tasks/Day | Claude Tier | Gemini | Flash-Lite | Total |
|------------|-----------|-------------|--------|-----------|-------|
| Light | 10-20 | Pro ($20) | $20-25 | $1 | **$41-46** |
| Moderate | 30-50 | Max 5x ($100) | $40-50 | $2 | **$142-152** |
| Heavy | 75-100+ | Max 20x ($200) | $50-60 | $3 | **$253-263** |

### Recommended Starting Point: Moderate Tier

For most users building and maintaining software projects:

```
Claude Max 5x subscription:  $100/month (fixed)
Gemini 3.1 Pro orchestration: $50/month (variable, ~$1.67/day)
Gemini Flash-Lite verification: $2/month (variable, ~$0.07/day)
─────────────────────────────────────────
TOTAL:                        ~$152/month
```

This supports 30-50 tasks/day, which covers:
- 2-3 active development projects
- Continuous refactoring and maintenance tasks
- Occasional batch operations (10-20 sub-tasks each)

### V3 vs. V1 Cost Comparison

The V3 architecture saves $30-50/month compared to V1 (three-tier with Opus API):

| Component | V1 (Opus API) | V3 (Subscription) | Savings |
|-----------|--------------|-------------------|---------|
| Claude | ~$150/mo (API, variable) | $100/mo (Max 5x, fixed) | $50/mo |
| Gemini | $50/mo | $50/mo | $0 |
| Flash-Lite | $2/mo | $2/mo | $0 |
| **Total** | **~$202/mo** | **~$152/mo** | **~$50/mo** |

The key savings come from moving to a fixed Claude subscription instead of
per-token API pricing. The Max 5x tier provides ample capacity for moderate use
at a predictable monthly cost.

### Cost Optimization Tips

| Tip | Impact | Details |
|-----|--------|---------|
| Lower TTL for simple tasks | Save $0.03-0.10/task | `ttl_max: 5` for well-defined tasks |
| Use CLI/API before Computer Use | Save $0.20-1.50/task | Avoid SUPERVISE mode when possible |
| Batch related tasks | Save on Gemini overhead | Single batch dispatch vs. individual |
| Set aggressive context offloading | Reduce token waste | Lower `offload_interval` to 3 for complex tasks |
| Review dead-letters daily | Prevent wasted retries | Abandon hopeless tasks early |

---

## Choosing an Access Method

### Decision Guide

```
Do you need real-time streaming output?
  YES → Happy Coder (native app, best performance)
  NO  ↓

Do you need push notifications for HITL approvals?
  YES → Happy Coder or Telegram
  NO  ↓

Are you on a shared/borrowed device?
  YES → Claude Code Remote (browser, no install)
  NO  ↓

Do you prefer conversational interface?
  YES → Telegram (private) or Discord (team)
  NO  ↓

Do you want the full terminal experience?
  YES → Claude Code Remote (browser-based terminal)
  NO  → Telegram (simplest, lowest friction)
```

### Recommended Multi-Channel Setup

Most operators use 2-3 channels simultaneously:

| Channel | Purpose |
|---------|---------|
| **Happy Coder** | Primary task dispatch and monitoring |
| **Telegram** | Backup channel, HITL approvals when away from Happy Coder |
| **Discord** | Team visibility, shared #approvals channel |

All channels connect to the same OpenClaw daemon. A task dispatched from Telegram
can be monitored in Happy Coder and approved via Discord. The channels are
interchangeable interfaces to the same pipeline.

---

## Cross-References

| Document | Relevance |
|----------|-----------|
| `docs/openclaw-gateway.md` | The daemon that all access methods connect to |
| `docs/completion-loop.md` | How dispatched tasks are executed |
| `docs/prompt-modes.md` | Modes that can be observed via streaming |
| `docs/anti-loop-safeguards.md` | Dead-letter notifications delivered to access channels |
| `docs/computer-use.md` | HITL-013/014 approvals via mobile channels |
| `security/hitl-gates.md` | HITL gate definitions approved via mobile channels |
| `docs/phase3-n8n-orchestration.md` | N8n workflows triggered via OpenClaw |
| `config/openclaw-config.yaml` | Channel and networking configuration |
