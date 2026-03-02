#!/usr/bin/env python3
"""Generate an executive-style PDF briefing for the AI Agent Pipeline.

Produces a supervisor-level overview covering:
- Mission status and key findings
- What each agent has accomplished
- Current task progress with completion estimates
- Evidence/findings highlights
- Infrastructure health
- Cost tracking
- What's next / blockers

Output: /tmp/pipeline-driver/pipeline-report.pdf
"""

import json
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from fpdf import FPDF


PIPELINE_DIR = Path("/home/brans/ai-agent-pipeline")
SESSION_DIR = Path.home() / ".claude/projects/-home-brans-ai-agent-pipeline"
DRIVER_DIR = Path("/tmp/pipeline-driver")
BRAIN_STORE = Path.home() / ".openclaw/brain-context-store.json"
COST_FILE = DRIVER_DIR / "cost-tracker.json"
OUTPUT_PDF = DRIVER_DIR / "pipeline-report.pdf"

AGENTS = ["alpha", "bravo", "charlie"]


def san(text: str) -> str:
    """Sanitize text for latin-1 PDF encoding."""
    replacements = {
        "\u2014": "--", "\u2013": "-", "\u2018": "'", "\u2019": "'",
        "\u201c": '"', "\u201d": '"', "\u2026": "...", "\u2588": "#",
        "\u2591": ".", "\u2022": "*", "\u25cf": "*", "\u2713": "[Y]",
        "\u2717": "[N]", "\u2605": "*", "\u00a0": " ", "\u00b6": "",
        "\u2003": " ", "\u2002": " ", "\u200b": "",
    }
    for k, v in replacements.items():
        text = text.replace(k, v)
    return text.encode("latin-1", errors="replace").decode("latin-1")


def get_session_stats(agent: str) -> dict:
    sid_file = DRIVER_DIR / f"{agent}-session-id.txt"
    if not sid_file.exists():
        return {}

    sid = sid_file.read_text().strip()
    jsonl = SESSION_DIR / f"{sid}.jsonl"
    if not jsonl.exists():
        return {"session_id": sid, "status": "file missing"}

    api_calls = 0
    tool_uses = 0
    output_tokens = 0
    mcp_tools = {}
    last_ts = ""

    with open(jsonl) as f:
        for line in f:
            try:
                d = json.loads(line)
                if d.get("type") == "assistant":
                    api_calls += 1
                    msg = d.get("message", {})
                    if isinstance(msg, dict):
                        output_tokens += msg.get("usage", {}).get("output_tokens", 0)
                        for block in msg.get("content", []):
                            if isinstance(block, dict) and block.get("type") == "tool_use":
                                tool_uses += 1
                                name = block.get("name", "unknown")
                                mcp_tools[name] = mcp_tools.get(name, 0) + 1
                ts = d.get("timestamp", "")
                if ts:
                    last_ts = ts
            except Exception:
                pass

    tmux_name = "alpha-supervisor" if agent == "alpha" else f"{agent}-work"
    running = subprocess.run(
        ["tmux", "has-session", "-t", tmux_name], capture_output=True
    ).returncode == 0

    size_kb = round(jsonl.stat().st_size / 1024, 1)

    return {
        "session_id": sid[:12],
        "status": "ACTIVE" if running else "completed/idle",
        "api_calls": api_calls,
        "tool_uses": tool_uses,
        "output_tokens": output_tokens,
        "size_kb": size_kb,
        "mcp_tools": mcp_tools,
        "last_activity": last_ts[:19] if last_ts else "unknown",
    }


class BriefingPDF(FPDF):
    def header(self):
        self.set_font("Helvetica", "B", 16)
        self.cell(0, 10, san("AI AGENT PIPELINE - EXECUTIVE BRIEFING"), new_x="LMARGIN", new_y="NEXT", align="C")
        self.set_font("Helvetica", "", 10)
        ts = datetime.now().strftime("%A, %B %d, %Y at %I:%M %p")
        self.cell(0, 6, san(ts), new_x="LMARGIN", new_y="NEXT", align="C")
        self.line(10, self.get_y() + 2, 200, self.get_y() + 2)
        self.ln(5)

    def footer(self):
        self.set_y(-15)
        self.set_font("Helvetica", "I", 8)
        self.cell(0, 10, san(f"Page {self.page_no()}/{{nb}} - NEXUS Pipeline Driver - Confidential"), align="C")

    def section(self, title: str):
        self.ln(3)
        self.set_font("Helvetica", "B", 12)
        self.set_fill_color(30, 30, 50)
        self.set_text_color(255, 255, 255)
        self.cell(0, 8, san(f"  {title}"), new_x="LMARGIN", new_y="NEXT", fill=True)
        self.set_text_color(0, 0, 0)
        self.ln(3)

    def subsection(self, title: str):
        self.set_font("Helvetica", "B", 10)
        self.set_text_color(30, 30, 120)
        self.cell(0, 6, san(title), new_x="LMARGIN", new_y="NEXT")
        self.set_text_color(0, 0, 0)

    def para(self, text: str, size: int = 9):
        self.set_font("Helvetica", "", size)
        self.set_x(10)
        self.multi_cell(190, 4.5, san(text))
        self.ln(1)

    def bullet(self, text: str, size: int = 9):
        self.set_font("Helvetica", "", size)
        self.set_x(15)
        self.multi_cell(180, 4.5, san(f"* {text}"))

    def kv(self, key: str, value: str):
        self.set_font("Helvetica", "B", 9)
        self.cell(50, 5, san(key), new_x="RIGHT")
        self.set_font("Helvetica", "", 9)
        self.cell(0, 5, san(value), new_x="LMARGIN", new_y="NEXT")


def generate_report() -> str:
    pdf = BriefingPDF()
    pdf.alias_nb_pages()
    pdf.add_page()

    # ── 1. MISSION STATUS ──
    pdf.section("1. MISSION STATUS")

    # Read taskboard for mission context
    taskboard = ""
    taskboard_path = PIPELINE_DIR / ".collab/shared/TASKBOARD.md"
    if taskboard_path.exists():
        taskboard = taskboard_path.read_text()

    # Extract mission from taskboard header
    mission_line = ""
    for line in taskboard.split("\n"):
        if "CASE MISSION" in line or "Goal:" in line or "goal:" in line.lower():
            mission_line = line.strip("> *")
            break

    if mission_line:
        pdf.para(mission_line)
    else:
        pdf.para("Legal case preparation: Ruiz v. Eight Eleven Group / Medasource")

    # Task summary
    working = taskboard.count("**WORKING**")
    done = taskboard.count("COMPLETED") + taskboard.count("DONE")
    open_tasks = taskboard.count("**OPEN**")
    total = working + done + open_tasks

    if total > 0:
        pct = round((done / total) * 100) if total > 0 else 0
        pdf.para(f"Overall progress: {done}/{total} tasks complete ({pct}%). "
                 f"{working} in progress, {open_tasks} waiting.")
    pdf.ln(2)

    # ── 2. AGENT ACTIVITY ──
    pdf.section("2. AGENT ACTIVITY (Claude Code Sessions)")

    total_api_calls = 0
    total_output_tokens = 0
    total_size_kb = 0

    for agent in AGENTS:
        stats = get_session_stats(agent)
        if not stats:
            pdf.subsection(f"{agent.upper()}: No active session")
            pdf.ln(2)
            continue

        status = stats.get("status", "unknown")
        calls = stats.get("api_calls", 0)
        tools = stats.get("tool_uses", 0)
        out_tokens = stats.get("output_tokens", 0)
        size = stats.get("size_kb", 0)

        total_api_calls += calls
        total_output_tokens += out_tokens
        total_size_kb += size

        status_label = "RUNNING" if status == "ACTIVE" else "idle"
        pdf.subsection(f"{agent.upper()} [{status_label}] - Session: {stats.get('session_id', '?')}")
        pdf.kv("API calls:", str(calls))
        pdf.kv("Tool uses:", str(tools))
        pdf.kv("Output tokens:", f"{out_tokens:,}")
        pdf.kv("Session size:", f"{size}KB")
        pdf.kv("Last activity:", stats.get("last_activity", "?"))

        # Top MCP tools used
        mcp = stats.get("mcp_tools", {})
        if mcp:
            top_tools = sorted(mcp.items(), key=lambda x: -x[1])[:5]
            tools_str = ", ".join(f"{n.split('__')[-1]}({c})" for n, c in top_tools)
            pdf.kv("Top tools:", tools_str)
        pdf.ln(2)

    # Usage estimate
    pdf.subsection("Combined Claude Usage Estimate")
    pdf.kv("Total API calls:", str(total_api_calls))
    pdf.kv("Total output tokens:", f"{total_output_tokens:,}")
    pdf.kv("Total session data:", f"{total_size_kb}KB ({round(total_size_kb/1024, 1)}MB)")
    # Rough cost estimate at Opus rates ($15/M in, $75/M out)
    est_cost = (total_output_tokens / 1_000_000) * 75
    pdf.kv("Est. Opus cost:", f"~${est_cost:.2f} (output tokens only, subscription covers this)")
    pdf.ln(2)

    # ── 3. KEY FINDINGS ──
    pdf.section("3. KEY FINDINGS (Brain-Context Cache)")

    if BRAIN_STORE.exists():
        try:
            store = json.loads(BRAIN_STORE.read_text())
            entries = store.get("entries", {})
            if isinstance(entries, dict) and entries:
                pdf.para(f"{len(entries)} findings cached by agents:")
                pdf.ln(1)
                for key, val in entries.items():
                    summary = val.get("summary", "") if isinstance(val, dict) else str(val)
                    pdf.subsection(key)
                    # Show full summary (truncate at 500 chars)
                    pdf.para(summary[:500] + ("..." if len(summary) > 500 else ""), size=8)
                    pdf.ln(1)
            else:
                pdf.para("No findings cached yet.")
        except Exception as e:
            pdf.para(f"Error reading cache: {e}")
    else:
        pdf.para("Brain-context store not found.")
    pdf.ln(2)

    # ── 4. TASK BREAKDOWN ──
    pdf.section("4. TASK BREAKDOWN")

    if taskboard:
        for line in taskboard.split("\n"):
            line = line.strip()
            if "|" in line and ("L0" in line or "L1" in line):
                parts = [p.strip() for p in line.split("|") if p.strip()]
                if len(parts) >= 4:
                    task_id = parts[0]
                    task_name = parts[1][:60]
                    assigned = parts[2] if len(parts) > 2 else "?"
                    status = parts[3] if len(parts) > 3 else "?"
                    pdf.set_font("Helvetica", "B", 9)
                    pdf.cell(15, 5, san(task_id), new_x="RIGHT")
                    pdf.set_font("Helvetica", "", 9)
                    pdf.cell(100, 5, san(task_name), new_x="RIGHT")
                    pdf.cell(25, 5, san(assigned), new_x="RIGHT")
                    # Color code status
                    if "WORKING" in status:
                        pdf.set_text_color(0, 100, 200)
                    elif "OPEN" in status:
                        pdf.set_text_color(150, 150, 0)
                    elif "DONE" in status or "COMPLETED" in status:
                        pdf.set_text_color(0, 150, 0)
                    pdf.cell(0, 5, san(status), new_x="LMARGIN", new_y="NEXT")
                    pdf.set_text_color(0, 0, 0)
    pdf.ln(2)

    # ── 5. GENERATED REPORTS ──
    pdf.section("5. DELIVERABLES")

    reports_dir = PIPELINE_DIR / "reports"
    if reports_dir.exists():
        for rpt in sorted(reports_dir.glob("L*")):
            content = rpt.read_text().strip()
            lines = content.split("\n")
            pdf.subsection(f"{rpt.name} ({len(lines)} lines)")
            # Show first 3 meaningful lines as preview
            preview_lines = [l.strip() for l in lines if l.strip() and not l.startswith("#") and not l.startswith("**Status")][:3]
            if preview_lines:
                pdf.para("  " + " | ".join(preview_lines)[:200], size=8)

    draft_dir = PIPELINE_DIR / ".collab/case/medasource/drafts"
    if draft_dir.exists():
        for draft in sorted(draft_dir.glob("*.md")):
            content = draft.read_text().strip()
            lines = content.split("\n")
            pdf.subsection(f"{draft.name} ({len(lines)} lines)")
            preview_lines = [l.strip() for l in lines if l.strip() and not l.startswith("#")][:2]
            if preview_lines:
                pdf.para("  " + " | ".join(preview_lines)[:200], size=8)
    pdf.ln(2)

    # ── 6. INFRASTRUCTURE ──
    pdf.section("6. INFRASTRUCTURE & COSTS")

    # Antigravity
    try:
        import urllib.request
        req = urllib.request.Request("http://127.0.0.1:8080/", method="HEAD")
        urllib.request.urlopen(req, timeout=3)
        pdf.kv("Antigravity:", "UP (gemini-3.x quota exhausted, 2.5-flash available)")
    except Exception:
        pdf.kv("Antigravity:", "DOWN")

    # OpenRouter cost
    if COST_FILE.exists():
        try:
            cost = json.loads(COST_FILE.read_text())
            pdf.kv("OpenRouter spend:", f"${cost.get('total_cost', 0):.4f} ({cost.get('calls', 0)} API calls)")
        except Exception:
            pass
    else:
        pdf.kv("OpenRouter spend:", "$0.00")

    # Tmux
    tmux = subprocess.run(["tmux", "list-sessions", "-F", "#{session_name}"], capture_output=True, text=True)
    sessions = tmux.stdout.strip().replace("\n", ", ") if tmux.returncode == 0 else "none"
    pdf.kv("Tmux sessions:", sessions)

    # Driver schedule
    pdf.kv("Driver schedule:", "Every 30 min (OpenClaw cron)")
    pdf.kv("Hourly reports:", "Every hour (system crontab)")
    pdf.ln(2)

    # ── 7. RECENT COMMS ──
    pdf.section("7. RECENT PIPELINE COMMUNICATIONS")
    messages_path = PIPELINE_DIR / ".collab/shared/MESSAGES.md"
    if messages_path.exists():
        msg_lines = messages_path.read_text().strip().split("\n")
        pdf.set_font("Helvetica", "", 8)
        for line in msg_lines[-20:]:
            line = line.strip()
            if line and not line.startswith("#"):
                try:
                    pdf.set_x(10)
                    pdf.multi_cell(190, 4, san(line[:140]))
                except Exception:
                    pass

    # Save
    DRIVER_DIR.mkdir(parents=True, exist_ok=True)
    pdf.output(str(OUTPUT_PDF))
    return str(OUTPUT_PDF)


def main():
    path = generate_report()
    print(path)


if __name__ == "__main__":
    main()
