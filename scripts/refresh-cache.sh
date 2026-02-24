#!/usr/bin/env bash
# refresh-cache.sh — Check and refresh expiring Gemini caches
# Runs every 90 minutes via OpenClaw cron or systemd timer.
# Checks if required caches are still alive; rebuilds if missing or expiring.
#
# Usage: ./scripts/refresh-cache.sh [cache-name|all]
# Default: all (checks all required caches)

set -euo pipefail

CACHE_NAME="${1:-all}"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_FILE="$PROJECT_DIR/.pipeline-run/cache-refresh.log"

mkdir -p "$(dirname "$LOG_FILE")"

log() {
  local msg="[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"
  echo "$msg" | tee -a "$LOG_FILE"
}

# Source .env
if [ -f "$PROJECT_DIR/.env" ]; then
  set -a
  source "$PROJECT_DIR/.env"
  set +a
fi

if [ -z "${GEMINI_API_KEY:-}" ]; then
  log "ERROR: GEMINI_API_KEY not set. Skipping cache refresh."
  exit 1
fi

# Check if a specific Gemini cache exists by querying it
check_cache() {
  local name="$1"
  log "Checking cache: $name"

  # Try to query the cache — if it responds, it's alive
  if command -v openclaw &>/dev/null; then
    local result
    result=$(openclaw agent -m "Use gemini-query-cache with cacheName '$name' and question 'Are you alive? Respond with just YES'" --json 2>/dev/null) || true

    if echo "$result" | grep -qi "yes"; then
      log "  Cache '$name': ALIVE"
      return 0
    fi
  fi

  # Fallback: try via the MCP tool directly
  # If openclaw isn't available or query failed, assume cache needs refresh
  log "  Cache '$name': MISSING or EXPIRED"
  return 1
}

# Refresh a specific cache
refresh_single() {
  local name="$1"
  log "Refreshing cache: $name"

  if check_cache "$name"; then
    log "  Cache '$name' is still active — no rebuild needed"
    return 0
  fi

  log "  Rebuilding cache '$name'..."
  if "$PROJECT_DIR/scripts/rebuild-cache.sh" "$name" 2>&1 | tee -a "$LOG_FILE"; then
    log "  Cache '$name' rebuilt successfully"
  else
    log "  WARNING: Cache '$name' rebuild failed (Gemini API may be unavailable)"
  fi
}

# Main logic
log "=== Cache Refresh Started ==="
log "Cache: $CACHE_NAME"

case "$CACHE_NAME" in
  all)
    refresh_single "pipeline-kb"
    refresh_single "pipeline-deliverables"
    log "Note: brain-context cache is dynamic (populated by agents on demand)"
    ;;
  pipeline-kb|pipeline-deliverables|brain-context)
    refresh_single "$CACHE_NAME"
    ;;
  *)
    log "ERROR: Unknown cache '$CACHE_NAME'. Options: pipeline-kb, pipeline-deliverables, brain-context, all"
    exit 1
    ;;
esac

log "=== Cache Refresh Complete ==="
