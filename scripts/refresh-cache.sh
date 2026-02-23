#!/usr/bin/env bash
# refresh-cache.sh — Refresh an expiring Gemini cache before it expires
# Called by the N8n cache monitor workflow (n8n-cache-monitor.json)
# when a required cache is expiring within 30 minutes.
#
# Unlike rebuild-cache.sh (which creates from scratch), this script
# attempts to extend the TTL of an existing cache first, and falls
# back to a full rebuild if extension fails.
#
# Usage: ./scripts/refresh-cache.sh <cache-name>
# Example: ./scripts/refresh-cache.sh pipeline-kb

set -euo pipefail

CACHE_NAME="${1:?Usage: refresh-cache.sh <cache-name>}"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Refreshing cache: $CACHE_NAME"

# Step 1: Attempt to extend the existing cache TTL
# NOTE: Gemini cache API may not support TTL extension directly.
# In that case, we delete and recreate (full rebuild).
#
# When running from N8n, replace with the appropriate MCP HTTP calls:
#   1. Check if cache exists: GET gemini-list-caches
#   2. If exists and near expiry: DELETE old cache, then CREATE new one
#   3. If missing: fall through to rebuild

echo "PLACEHOLDER: Attempting TTL extension for cache '$CACHE_NAME'"
echo "PLACEHOLDER: gemini-query-cache cacheName:$CACHE_NAME question:'ping'"

# Step 2: If extension fails or cache is missing, do a full rebuild
echo "Falling back to full rebuild..."
exec "$PROJECT_DIR/scripts/rebuild-cache.sh" "$CACHE_NAME"
