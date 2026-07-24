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

cd "$INTERACT_ROOT"

echo "Linking the new Supabase project..."
pnpm dlx supabase link --project-ref "$PROJECT_REF"

echo "Creating the InterAct database, Realtime publication, and Storage bucket..."
pnpm dlx supabase db query --linked --file supabase/schema.sql

echo "Deploying the core Edge Functions..."
pnpm dlx supabase functions deploy \
  create-session participant-action presenter-action \
  --project-ref "$PROJECT_REF" \
  --no-verify-jwt \
  --use-api

echo "Supabase core deployment completed."
