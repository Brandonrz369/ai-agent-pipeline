# V3 Blueprint — Two-Tier Agent Architecture

FINAL BLUEPRINT  •  V3.0
Two-Tier Agent Architecture
Gemini Orchestrator + Claude Code Brain/Executor/Supervisor
With Vision, Computer Use, and Brain Damage Prevention
Zero Anthropic API Keys Required
V3 — WHAT CHANGED FROM V2
Claude Code is now the SUPERVISOR too. It has vision. It can see the screen, watch GUI tasks execute, and know when things go wrong — Gemini can't do any of that.
Computer Use integration. For GUI tasks (installing apps, clicking through wizards, registering accounts), Claude Code gets mouse/keyboard/screenshot control.
Brain damage prevention. Long-running supervisor sessions get their context offloaded to Gemini via MCP cache, keeping Claude Code sharp and lean.
No Anthropic API key still. Computer Use runs through Claude Code on your subscription, not through the API.
Est. Cost: ~$50–60/mo Gemini + $20–200/mo Claude Subscription
Industrial-Grade Anti-Loop Safeguards  •  Mobile Access via Happy Coder + Tailscale
February 2026  |  Final Revision from V1 (Three-Tier) and V2 (Two-Tier)
Table of Contents
1. Architecture Overview  —  The complete picture in one diagram
2. Role Definitions  —  Who does what — Gemini, Claude Code, Computer Use
3. Claude Code: Brain + Executor + Supervisor  —  Three hats, one tool
4. Computer Use for GUI Tasks  —  Vision, mouse, keyboard — installing apps and clicking through wizards
5. Brain Damage Prevention  —  Gemini MCP cache keeps Claude Code lean
6. The Three Prompt Modes  —  Execute, Architect, Supervise
7. The Completion Loop  —  Gemini drives, Claude Code works, anti-loop safeguards protect
8. Anti-Loop Safeguards  —  TTL, hysteresis, handshake validation
9. Real-World Example  —  Building a job application bot end-to-end
10. Remote Mobile Access  —  Happy Coder + Tailscale
11. Cost Analysis  —  Flat sub + Gemini tokens
12. Implementation Phases  —  Weekend to production
13. ToS Compliance  —  Why this is fully allowed
14. Risk Assessment  —  What can go wrong
1. Architecture Overview
This is a two-tier system where Gemini 3.1 Pro is the traffic cop and Claude Code is the entire workforce — brain, executor, and supervisor all in one.
System Diagram
YOU (Phone / Telegram / Discord)
|
v
OPENCLAW GATEWAY (always running on your machine)
|
v
GEMINI 3.1 PRO (orchestrator — NOT the brain)
|--- Receives your request
|--- Decomposes into tasks
|--- Simple stuff (calendar, email): OpenClaw built-in tools
|--- Everything else: delegates to Claude Code
|
+===> CLAUDE CODE (the brain + executor + supervisor)
|       |
|       |--- MODE A: EXECUTE
|       |    Write code, edit files, run shell commands
|       |    "Build the Discord bot in Python"
|       |
|       |--- MODE B: ARCHITECT
|       |    Deep strategic reasoning (Read-only)
|       |    "Why did attempts 1-3 fail? Give me a new plan."
|       |
|       |--- MODE C: SUPERVISE + COMPUTER USE
|       |    Vision + mouse + keyboard for GUI tasks
|       |    "Install Discord app, register account, set up server"
|       |    Takes screenshots, sees failures, self-corrects
|       |
|       |--- BRAIN DAMAGE PREVENTION
|       |    Long sessions offload context to Gemini MCP cache
|       |    Claude Code stays lean: current state + compressed history
|       |
|       +--- Returns results to Gemini
|
+--- Gemini checks success, drives retry loop, sends results to you
|
+--- ANTI-LOOP SAFEGUARDS (TTL / Hysteresis / Handshake)
Component
Role
Cost
When Used
OpenClaw + Gemini 3.1 Pro
Route, format, loop, summarize
$2/$12 per MTok
Every request
Gemini Flash-Lite
Verify results, classify tasks
$0.10/$0.40 per MTok
Every evaluation
Claude Code (Execute)
Write code, files, shell
Flat subscription
Most tasks
Claude Code (Architect)
Deep reasoning, blueprints
Flat subscription
After failures
Claude Code (Supervise)
Vision + GUI monitoring
Flat subscription
GUI tasks
Computer Use (via Claude)
Mouse, keyboard, screenshots
Flat subscription
Installing apps, wizards
Gemini MCP Cache
Offload long session context
$0.10/$0.40 per MTok
Long-running supervision
Happy Coder + Tailscale
Phone remote access
Free
Always
2. Role Definitions
Gemini 3.1 Pro = Traffic Cop
Gemini does NOT think hard. It routes, formats, and drives the loop. Think of it as a very smart secretary who knows exactly which questions to ask the expert and how to package the answers for your phone.
Gemini DOES
Gemini DOES NOT
Classify task type
Write code or reason about architecture
Format prompts for Claude Code
Make strategic decisions
Parse JSON results
Debug errors deeply
Check pass/fail criteria
Evaluate code quality
Drive the retry loop
Monitor GUI interactions
Summarize for mobile
See the screen or use vision
Claude Code = Brain + Hands + Eyes
Claude Code does ALL the intellectual work. It writes code. It analyzes failures. It watches the screen during GUI tasks and knows when something went wrong. It's the only component with actual intelligence.
Claude Code DOES
Claude Code DOES NOT
Write and debug code
Route between tasks (Gemini's job)
Reason about architecture
Manage the retry loop (Gemini's job)
See the screen via vision/Computer Use
Run 24/7 as a daemon (stateless between calls)
Control mouse and keyboard for GUI tasks
Summarize for mobile display (Gemini's job)
Self-correct when it sees failures
Remember past sessions without help (needs MCP cache)
Provide strategic blueprints
Decide when to escalate (Gemini counts failures)
3. Claude Code: Brain + Executor + Supervisor
The key insight of V3: Claude Code wears three hats depending on the prompt mode. It's the same tool, same subscription, same CLI — just different prompt framings and tool permissions.
HAT 1: EXECUTOR
When: First attempt at any task, or executing steps from an architect blueprint.
Tools: Bash, Read, Write, Edit (full execution permissions).
Prompt: "Fix the auth bug in auth.py. Run tests to verify."
Output: Code changes, test results, file modifications.
HAT 2: ARCHITECT
When: After N execution failures, or when Gemini detects circular reasoning.
Tools: Read only (prevents premature execution during planning).
Prompt: "Attempts 1-3 failed. Analyze root cause. Provide a step-by-step blueprint."
Output: Root cause analysis, step-by-step plan with all variables, verification criteria.
HAT 3: SUPERVISOR (NEW IN V3)
When: GUI tasks that need vision — installing software, navigating setup wizards, registering accounts.
Tools: Computer Use (screenshots + mouse + keyboard) + Bash + Read + Write.
Prompt: "Install the Discord app, open it, register with these credentials, create a server called X."
Output: Continuous monitoring — takes screenshots, evaluates progress, self-corrects on failures.
Key difference: Claude Code can SEE the screen. It knows when a dialog box popped up wrong, when a click missed, when a download stalled. Gemini can't do this.
Why Claude Code is the natural supervisor: It understands code AND can see the screen. When it's watching a Python script run a browser automation task, it can read the error traceback, see the browser window, understand why the CSS selector failed, and fix it — all in one session. Gemini would need the error text relayed to it, couldn't see the browser, and couldn't fix the code.
4. Computer Use for GUI Tasks
When Claude Code needs to interact with desktop applications — not just code and terminal — it uses the Computer Use capability for full mouse/keyboard/vision control.
What Computer Use Enables
Install applications: Download .dmg/.exe, click through installer, handle UAC prompts.
Navigate GUI wizards: Discord setup, Slack onboarding, account registration flows.
Fill native forms: PDF forms in Adobe, desktop app settings, system preferences.
Monitor visual state: See error dialogs, loading spinners, success screens.
Multi-window workflows: Open terminal + browser + app simultaneously, switch between them.
How It Works
Claude Code takes a screenshot, analyzes it with vision, decides what to click/type, executes the action, takes another screenshot to verify. This loop continues until the task is done or it encounters something it can't handle.
COMPUTER USE LOOP (runs inside Claude Code supervisor session):
1. Take screenshot of current desktop state
2. Analyze: What do I see? What's the next action?
3. Execute: Move mouse to (x,y), click / type / press key
4. Take new screenshot
5. Evaluate: Did the action succeed?
YES -> Continue to next step
NO  -> Analyze what went wrong, try alternative approach
6. Repeat until task complete or failure threshold hit
When NOT to Use Computer Use
Computer Use is slow (screenshot-analyze-act loop) and token-expensive (each screenshot is ~1500 tokens). Use it only when there's no programmatic alternative:
Web automation: Use OpenClaw's browser CDP instead — 10x faster, reads accessibility tree instead of screenshots.
File operations: Use Claude Code's normal Bash/Read/Write tools.
Terminal commands: Use normal shell execution.
API interactions: Call APIs directly, don't click through web UIs.
Rule of thumb: if there's a CLI or API for it, use that. Computer Use is the fallback for things that only exist as GUI.
5. Brain Damage Prevention
The problem: Claude Code as a supervisor needs to monitor tasks over time. But each screenshot, each status check, each evaluation adds tokens to its context window. After 20 minutes, the session is bloated with stale information and Claude Code starts making mistakes. This is "brain damage" — context rot from accumulated history.
THE SOLUTION: GEMINI MCP CACHE
Concept: Offload Claude Code's long-term memory to Gemini via MCP servers. Claude Code stays sharp by only seeing: (1) current state, (2) compressed summary of what happened before. Gemini handles the cheap storage and summarization.
Why Gemini: Summarizing old context is a simple task — perfect for Flash-Lite at $0.10/$0.40 per MTok. Claude Code's expensive subscription tokens should be spent on thinking, not remembering.
How It Works
BRAIN DAMAGE PREVENTION FLOW:
Claude Code starts supervising a task
|
+--- Takes actions, accumulates context
|
+--- Every N steps (e.g., every 5 actions):
|     1. Extract key facts from recent context
|     2. Send to Gemini MCP cache server:
|        "Summarize: [raw context from last 5 steps]"
|     3. Gemini Flash-Lite compresses to ~200 tokens
|     4. Store compressed summary in MCP memory
|
+--- When Claude Code needs history:
|     1. Query MCP cache: "What happened so far?"
|     2. Get compressed summary (not raw history)
|     3. Current state + summary = lean context
|
+--- Result: Claude Code context stays under ~50K tokens
even for tasks that run 30+ minutes
MCP Server Configuration
The Gemini cache runs as an MCP server that Claude Code can query. It exposes two tools: store_context (sends raw context to Gemini for compression) and get_summary (retrieves compressed history).
// MCP server config for Claude Code
"mcpServers": {
"gemini-cache": {
"command": "node",
"args": ["gemini-cache-mcp/index.js"],
"env": {
"GEMINI_API_KEY": "your-key",
"GEMINI_MODEL": "gemini-2.5-flash-lite",
"MAX_SUMMARY_TOKENS": "200"
}
}
}
OpenClaw benefits too: The same Gemini MCP cache pattern can keep OpenClaw's Gemini orchestrator lean. Long conversations with Gemini 3.1 Pro accumulate context; periodically compressing older turns via Flash-Lite keeps orchestration fast and cheap.
6. The Three Prompt Modes
Gemini's primary job is constructing the right prompt for Claude Code. Instead of switching between models, you switch between prompt framings.
Execute Prompt
TASK: {description}
CONTEXT: Working dir: {path} | Files: {list}
INSTRUCTIONS: Execute the task. Run verification.
SUCCESS CRITERIA: {criteria}
ALLOWED TOOLS: Bash, Read, Write, Edit
Architect Prompt
ROLE: Senior architect. Do NOT execute. Analyze and plan.
TASK: {original_request}
FAILED ATTEMPTS: {attempt_1_error}, {attempt_2_error}, ...
PROVIDE: Root cause, correct approach, step-by-step plan,
all variables, verification criteria, edge cases.
ALLOWED TOOLS: Read only
Supervise Prompt (New in V3)
TASK: {GUI_task_description}
CREDENTIALS: {if needed, provided securely}
INSTRUCTIONS:
1. Take a screenshot to see current state
2. Execute the next GUI action (click/type/etc)
3. Take another screenshot to verify
4. If something went wrong, analyze and self-correct
5. Every 5 steps, offload context to gemini-cache MCP
6. Continue until task is complete
SUCCESS CRITERIA: {visual_criteria}
ALLOWED TOOLS: Computer Use, Bash, Read, Write, gemini-cache
7. The Completion Loop
TASK ENTERS (Gemini receives your request)
|
+--> Gemini classifies: simple tool? code task? GUI task?
|
+--> CODE TASK:
|     [1] Gemini formats EXECUTE prompt
|     [2] Claude Code executes, returns JSON
|     [3] Flash-Lite verifies success
|     [4] Success? --> Summarize, send to your phone
|     [5] Failure? --> Check anti-loop safeguards
|         Hops < 3? --> Gemini adjusts prompt, GOTO [1]
|         Hops >= 3? --> ARCHITECT prompt, get blueprint
|                       New session, execute blueprint
|
+--> GUI TASK:
|     [1] Gemini formats SUPERVISE prompt
|     [2] Claude Code enters Computer Use loop
|         Screenshot -> Analyze -> Act -> Screenshot -> Verify
|         Offloads context to Gemini MCP every 5 steps
|     [3] Claude Code reports done or stuck
|     [4] Stuck? --> ARCHITECT prompt for new approach
|
+--> ANTI-LOOP: TTL=10 hops | Hysteresis | Backflow detection
8. Anti-Loop Safeguards
THE THREE LAWS OF AGENT LOOPS
1. Every task must terminate. TTL counter: max 10 hops. Expired = dead-letter queue + phone notification.
2. Escalation must be sticky. Hysteresis: 3 failures to enter architect mode, 2 successes to leave. No oscillation.
3. Cycles must be detected. Handshake: hash files before/after execution. If new hash matches any previous hash = A-B-A backflow. Blocked immediately.
Task Envelope
task_envelope = {
id: "task_abc123",
ttl_max: 10,
hops: 0,
mode: "execute",     // execute | architect | supervise
state_hashes: [],    // for backflow detection
consecutive_failures: 0,
consecutive_successes: 0,
escalated: false,
session_ids: [],     // all Claude Code sessions used
mcp_cache_key: "",  // Gemini cache reference
}
Dead-Letter Queue
Tasks that hit TTL limit get dumped to ~/.openclaw/dead-letter/ with full context. A push notification via Telegram tells you on your phone. You can inspect and decide whether to retry with different parameters or give up.
9. Real-World Example: Job Application Bot
You message OpenClaw from your phone: "Build me a bot that applies to 10 software engineer jobs using my resume. Set up its own Discord server for status updates."
How the System Handles It
Gemini decomposes the task: (a) Build the Python bot, (b) Set up Discord server, (c) Connect bot to Discord, (d) Run the bot to apply to 10 jobs.
Sub-task (a) — EXECUTE mode: Gemini formats an execute prompt. Claude Code writes the Python bot using Selenium/Playwright, creates the project structure, writes tests. Multiple Claude Code sessions if needed (oh-my-claudecode Ultrapilot for parallel work on different modules).
Sub-task (b) — SUPERVISE mode: This needs GUI interaction. Claude Code enters Computer Use mode: opens Discord app (or installs it first), registers account using your email/password, creates a server, configures channels for job-application-status and errors. Takes screenshots at each step to verify. Offloads context to Gemini MCP cache every 5 steps.
Sub-task (c) — EXECUTE mode: Claude Code generates Discord bot token via Discord Developer Portal (browser automation via OpenClaw CDP), wires it into the Python bot, tests the connection.
Sub-task (d) — SUPERVISE mode: Claude Code runs the bot, monitors the first 2–3 applications via vision to make sure forms are filling correctly. If a job site has a weird form layout that breaks the automation, Claude Code sees the failure on screen, analyzes it, fixes the selector, and retries.
Results: Gemini summarizes everything for your phone: "Bot built, Discord server created, 10 applications submitted. 8 succeeded, 2 sites had CAPTCHAs. Status updates posting to #job-status in your Discord."
Total Claude Code sessions: ~8–12 invocations across all sub-tasks. Total Gemini orchestration tokens: ~30K. All on flat-rate subscription + cheap Gemini API.
10. Remote Mobile Access
Control everything from your phone without SSH or remote desktop.
Happy Coder: Native iOS/Android app (11,700 stars). End-to-end encrypted, push notifications, voice input, real-time Claude Code output streaming.
Tailscale: Secure mesh VPN between phone and home machine. 10 min setup, zero port forwarding. Your OpenClaw is only accessible to your devices.
Alternative — Claude Code Remote: Zero-config via Cloudflare Tunnel with QR code pairing. Works in any mobile browser.
Alternative — Telegram/Discord: OpenClaw natively supports both as messaging channels. Message your agent from any chat app.
11. Cost Analysis
Component
Type
Monthly Cost
Notes
Gemini 3.1 Pro
Variable
$50–60
75 tasks/day, orchestration
Gemini Flash-Lite
Variable
$1–3
Verification + MCP cache
Claude Sub (Pro)
Fixed
$20
Light use, 10–20 tasks/day
Claude Sub (Max 5x)
Fixed
$100
Moderate, 30–50 tasks/day
Claude Sub (Max 20x)
Fixed
$200
Heavy, 75–100+ tasks/day
TOTAL (moderate)
—
$150–165
Max 5x + Gemini + Flash-Lite
Compared to V1 (three-tier): V1 cost $120–210/month including ~$50/mo for Opus API tokens. V3 eliminates that variable cost entirely. The Gemini MCP cache adds maybe $1–3/month. Net savings: $30–50/month at moderate usage.
12. Implementation Phases
Phase 1: Foundation (Weekend)
Install OpenClaw, configure Gemini 3.1 Pro as only model provider
Connect Telegram or Discord as messaging channel
Install Tailscale on home machine + phone
Test: send messages from phone, Gemini responds through OpenClaw
Phase 2: Claude Code Integration (1–2 Evenings)
Create OpenClaw skill that invokes claude -p with JSON output
Implement Execute mode prompt template
Implement Architect mode prompt template
Test: Gemini routes a coding task to Claude Code, evaluates result
Phase 3: Anti-Loop + Supervisor (1–2 Evenings)
Build task envelope with TTL, state hashes, hysteresis counters
Implement Supervise mode with Computer Use for GUI tasks
Build Gemini MCP cache server for brain damage prevention
Test with intentionally failing tasks to verify bounded termination
Phase 4: Polish (Ongoing)
Install Happy Coder for native mobile app
Add oh-my-claudecode for parallel sessions
Build custom OpenClaw skills for frequent workflows
Set up SOUL.md for personalized agent personality
Fine-tune escalation thresholds from real usage data
13. ToS Compliance
FULLY COMPLIANT BY DESIGN
OpenClaw uses Gemini only. No Claude subscription tokens shared with any third-party tool.
Claude Code is an official Anthropic tool. Using it via CLI is its designed purpose. Computer Use is a supported beta feature.
You initiate every task. From your phone, through Telegram/Discord. Not autonomous 24/7 operation.
No Anthropic API key. No API Commercial Terms apply. Everything runs on subscription.
GRAY AREA
Programmatic invocation of Claude Code 50–100 times/day is more automated than typical individual use. This is the same pattern as CI/CD pipelines, which Anthropic explicitly supports. Worst case if they tighten enforcement: throttling, not account termination. You're using their official tool in its documented headless mode.
14. Risk Assessment
Risk
Prob.
Impact
Mitigation
Claude Code rate limits
High
Slower
Queue tasks, Ecomode, upgrade plan
Computer Use unreliable on complex GUIs
Medium
Failed GUI tasks
Fallback to browser CDP or manual
Gemini 3.1 Pro pricing at GA
Medium
Cost increase
2.5 Pro as fallback orchestrator
Brain damage despite MCP cache
Low-Med
Quality drop
Fresh sessions for new sub-tasks
OpenClaw breaking changes
Medium
Downtime
Pin version, monitor changelog
Anthropic tightens automated usage
Low
Throttling
Official tool, documented mode
Security (shell + Computer Use access)
Medium
Exposure
Docker/VM isolation, restrict scope
Anti-loop false positives
Low
Premature kills
Tune thresholds from real data
Quick Reference Card
THE SYSTEM IN ONE SENTENCE
Gemini routes your requests and drives the retry loop. Claude Code does ALL the thinking, coding, and GUI supervision. Gemini MCP cache prevents brain damage. Anti-loop safeguards guarantee bounded cost.
THREE PROMPT MODES
Execute: "Do this thing." Full tools. First attempt at any task.
Architect: "Why did this fail? Plan a new approach." Read-only. After 3 failures.
Supervise: "Install this app and set it up." Computer Use + vision. GUI tasks.
ANTI-LOOP LAWS
TTL: Max 10 hops. Dead-letter queue + push notification on expiry.
Hysteresis: 3 failures to escalate. 2 successes to de-escalate. No flicker.
Handshake: Hash files. If execution returns to a previously-seen state, block it.
KEY COMMANDS
claude -p "<prompt>" --output-format json  —  Execute mode
claude -p "<prompt>" --allowedTools Read  —  Architect mode
claude -p "<prompt>" --resume <id>  —  Resume session
openclaw models set google/gemini-3.1-pro  —  Set orchestrator
End of Blueprint  •  V3.0 Final
February 2026  |  Gemini Orchestrator + Claude Code Brain/Executor/Supervisor