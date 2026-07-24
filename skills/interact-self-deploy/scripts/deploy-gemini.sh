#!/usr/bin/env bash

set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "Usage: $0 PROJECT_REF [MODEL]" >&2
  exit 1
fi

PROJECT_REF="$1"
MODEL="${2:-gemini-3.6-flash}"
validate_project_ref "$PROJECT_REF"
require_command pnpm

API_KEY="$(read_secret 'Paste the Google AI Studio Gemini API key')"
if [[ -z "$API_KEY" ]]; then
  echo "Gemini API key is required." >&2
  exit 1
fi

SECRET_FILE="$(mktemp "${TMPDIR:-/tmp}/interact-gemini.XXXXXX")"
cleanup() {
  API_KEY=''
  rm -f "$SECRET_FILE"
}
trap cleanup EXIT

umask 077
printf 'GEMINI_API_KEY=%s\nGEMINI_MODEL=%s\n' "$API_KEY" "$MODEL" > "$SECRET_FILE"

cd "$INTERACT_ROOT"
pnpm dlx supabase secrets set \
  --project-ref "$PROJECT_REF" \
  --env-file "$SECRET_FILE"
pnpm dlx supabase functions deploy \
  ai-exit-ticket-summary \
  ai-screen-preview \
  ai-short-answer-summary \
  analyze-question \
  analyze-session \
  generate-exit-ticket \
  --project-ref "$PROJECT_REF" \
  --no-verify-jwt \
  --use-api

echo "Gemini deployment completed with model $MODEL."
