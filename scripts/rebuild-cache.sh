#!/usr/bin/env bash
# rebuild-cache.sh — Rebuild a Gemini cache from source files
# Called by the N8n cache monitor workflow (n8n-cache-monitor.json)
# when a required cache is missing.
#
# Usage: ./scripts/rebuild-cache.sh <cache-name>
# Example: ./scripts/rebuild-cache.sh pipeline-kb

set -euo pipefail

CACHE_NAME="${1:?Usage: rebuild-cache.sh <cache-name>}"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TMP_DIR="/tmp/cache-rebuild"

mkdir -p "$TMP_DIR"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Rebuilding cache: $CACHE_NAME"

case "$CACHE_NAME" in
  pipeline-kb)
    # Concatenate all knowledge base source documents
    cat \
      "$PROJECT_DIR"/ARCHITECTURE.md \
      "$PROJECT_DIR"/GTG1002_ANALYSIS.md \
      "$PROJECT_DIR"/docs/*.md \
      > "$TMP_DIR/pipeline-kb.txt"

    # Create the Gemini cache via MCP
    # NOTE: This command runs inside a Claude Code session or via MCP client.
    # When called from N8n, replace with the appropriate MCP HTTP call:
    #   POST to Gemini MCP server endpoint with:
    #     filePath: /tmp/cache-rebuild/pipeline-kb.txt
    #     displayName: pipeline-kb
    #     ttlMinutes: 120
    echo "PLACEHOLDER: gemini-create-cache filePath:$TMP_DIR/pipeline-kb.txt displayName:pipeline-kb ttlMinutes:120"
    ;;

  pipeline-deliverables)
    # Concatenate all deliverable files
    cat \
      "$PROJECT_DIR"/schemas/*.json \
      "$PROJECT_DIR"/security/*.md \
      "$PROJECT_DIR"/reports/*.md \
      > "$TMP_DIR/pipeline-deliverables.txt" 2>/dev/null || true

    # Create the Gemini cache via MCP
    # NOTE: Same as above — replace with MCP HTTP call in production.
    echo "PLACEHOLDER: gemini-create-cache filePath:$TMP_DIR/pipeline-deliverables.txt displayName:pipeline-deliverables ttlMinutes:120"
    ;;

  brain-context)
    # Brain damage prevention cache is dynamic — populated by agents via MCP store_context calls.
    # This case clears stale entries and creates an empty placeholder cache.
    echo "NOTE: brain-context cache is dynamically populated via MCP store_context calls."
    echo "Creating empty placeholder cache for initialization."
    cat > "$TMP_DIR/brain-context.txt" <<BRAIN_EOF
{
  "type": "brain-damage-prevention",
  "description": "Dynamic cache for Claude Code session context offloading",
  "created": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "cache_key_format": "{task_id}-{session_id}-{block_name}",
  "max_summary_tokens": 200,
  "compression_model": "gemini-2.5-flash-lite"
}
BRAIN_EOF
    echo "PLACEHOLDER: gemini-create-cache filePath:$TMP_DIR/brain-context.txt displayName:brain-context ttlMinutes:1440"
    ;;

  *)
    echo "ERROR: Unknown cache name '$CACHE_NAME'. Check config/required-caches.yaml."
    exit 1
    ;;
esac

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Cache rebuild initiated for: $CACHE_NAME"
