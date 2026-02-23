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

  *)
    echo "ERROR: Unknown cache name '$CACHE_NAME'. Check config/required-caches.yaml."
    exit 1
    ;;
esac

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Cache rebuild initiated for: $CACHE_NAME"
