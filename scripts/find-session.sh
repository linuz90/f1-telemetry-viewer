#!/usr/bin/env bash
#
# Resolve a session slug or URL to the telemetry JSON file on disk.
#
# Usage:
#   ./scripts/find-session.sh race-baku-manual-2026-02-21-16-39-26
#   ./scripts/find-session.sh http://localhost:5173/session/race-baku-manual-2026-02-21-16-39-26
#
# Reads TELEMETRY_DIR from .env in the project root.
# Prints the absolute path to the matching JSON file (if found).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Load TELEMETRY_DIR from .env
if [[ ! -f "$PROJECT_ROOT/.env" ]]; then
  echo "Error: .env file not found at $PROJECT_ROOT/.env" >&2
  exit 1
fi

TELEMETRY_DIR="$(grep '^TELEMETRY_DIR=' "$PROJECT_ROOT/.env" | cut -d'=' -f2-)"
if [[ -z "$TELEMETRY_DIR" ]]; then
  echo "Error: TELEMETRY_DIR not set in .env" >&2
  exit 1
fi

if [[ ! -d "$TELEMETRY_DIR" ]]; then
  echo "Error: TELEMETRY_DIR does not exist: $TELEMETRY_DIR" >&2
  exit 1
fi

# Accept a slug or a full URL — extract the slug part
INPUT="${1:-}"
if [[ -z "$INPUT" ]]; then
  echo "Usage: $0 <slug-or-url>" >&2
  echo "  e.g. $0 race-baku-manual-2026-02-21-16-39-26" >&2
  echo "  e.g. $0 http://localhost:5173/session/race-baku-manual-2026-02-21-16-39-26" >&2
  exit 1
fi

# Strip URL prefix if present (handle any host/port)
SLUG="${INPUT##*/session/}"
# If still has protocol/host (no /session/ in URL), use as-is
SLUG="${SLUG##*/}"

# Convert slug to filename pattern: replace hyphens with underscores
# The toSlug() function does: basename → lowercase → replace _ with -
# So we reverse: replace - with _ to get a case-insensitive filename pattern
PATTERN="$(echo "$SLUG" | tr '-' '_')"

# Find matching file (case-insensitive since slug is lowercased)
MATCH="$(find "$TELEMETRY_DIR" -iname "${PATTERN}.json" -type f 2>/dev/null | head -1)"

if [[ -z "$MATCH" ]]; then
  echo "Error: No file matching slug '$SLUG' found under $TELEMETRY_DIR" >&2
  exit 1
fi

echo "$MATCH"
