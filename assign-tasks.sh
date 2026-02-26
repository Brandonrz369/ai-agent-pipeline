#!/bin/bash
# Update TASKBOARD.md
sed -i 's/| T19 | Dead code cleanup.*/| T19 | Dead code cleanup — remove unused modules and dead logic in legacy agency | BRAVO | **DONE** (needs review) | P2 |/' /home/brans/ai-agent-pipeline/.collab/shared/TASKBOARD.md
sed -i 's/| T24 | Docker build & test.*/| T24 | Docker build & test — verify Dockerfile, docker-compose, and health checks | CHARLIE | **DONE** (needs review) | P2 |/' /home/brans/ai-agent-pipeline/.collab/shared/TASKBOARD.md
sed -i 's/| T20 | CLI help text polish.*/| T20 | CLI help text polish — add examples and --help to all subcommands | BRAVO | **NEXT** | P3 |/' /home/brans/ai-agent-pipeline/.collab/shared/TASKBOARD.md
sed -i 's/| T27 | Add SUPERVISE mode.*/| T27 | Add SUPERVISE mode — Computer Use screenshot+click loop | CHARLIE | **NEXT** | P2 |/' /home/brans/ai-agent-pipeline/.collab/shared/TASKBOARD.md

# Update ALPHA STATUS
sed -i 's/Standing By.*/Standing By\n- BRAVO: T19 done, assigned T20 (CLI help text polish)\n- CHARLIE: T24 done, assigned T27 (Add SUPERVISE mode)/' /home/brans/ai-agent-pipeline/.collab/alpha/STATUS.md

# Update BRAVO STATUS
sed -i 's/Next Task: —/Next Task: T20 — CLI help text polish/' /home/brans/ai-agent-pipeline/.collab/bravo/STATUS.md
sed -i 's/Current Status: DONE: T19 — Dead code cleanup complete/Current Status: WORKING: T20 — CLI help text polish/' /home/brans/ai-agent-pipeline/.collab/bravo/STATUS.md

# Update CHARLIE STATUS
sed -i 's/Current Status: DONE: T24 -- Docker build & test/Current Status: WORKING: T27 — Add SUPERVISE mode/' /home/brans/ai-agent-pipeline/.collab/charlie/STATUS.md

# Send message
echo "[$(date -u +'%Y-%m-%dT%H:%MZ')] NEXUS->ALL: Assessed state.
- **ALPHA**: Please review T19 (BRAVO) and T24 (CHARLIE).
- **BRAVO**: Assigned T20 (CLI help text polish).
- **CHARLIE**: Assigned T27 (Add SUPERVISE mode).
Spawning sessions now." >> /home/brans/ai-agent-pipeline/.collab/shared/MESSAGES.md
