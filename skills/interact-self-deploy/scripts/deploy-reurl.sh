#!/usr/bin/env bash

set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 PROJECT_REF" >&2
  exit 1
fi

PROJECT_REF="$1"
validate_project_ref "$PROJECT_REF"
require_command pnpm

API_KEY="$(read_secret 'Paste the Reurl.cc API key')"
if [[ -z "$API_KEY" ]]; then
  echo "Reurl API key is required." >&2
  exit 1
fi

SECRET_FILE="$(mktemp "${TMPDIR:-/tmp}/interact-reurl.XXXXXX")"
cleanup() {
  API_KEY=''
  rm -f "$SECRET_FILE"
}
trap cleanup EXIT

umask 077
printf 'REURL_API_KEY=%s\n' "$API_KEY" > "$SECRET_FILE"

cd "$INTERACT_ROOT"
pnpm dlx supabase secrets set \
  --project-ref "$PROJECT_REF" \
  --env-file "$SECRET_FILE"
pnpm dlx supabase functions deploy \
  shorten-url \
  --project-ref "$PROJECT_REF" \
  --no-verify-jwt \
  --use-api

echo "Reurl deployment completed."
