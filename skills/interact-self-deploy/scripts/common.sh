#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INTERACT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

require_command() {
  local command_name="$1"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required command not found: $command_name" >&2
    exit 1
  fi
}

validate_project_ref() {
  local project_ref="$1"
  if [[ ! "$project_ref" =~ ^[a-z0-9]{20}$ ]]; then
    echo "Project ref must contain exactly 20 lowercase letters or digits." >&2
    exit 1
  fi
}

read_secret() {
  local prompt="$1"
  local secret

  printf '%s: ' "$prompt" >&2
  trap 'stty echo 2>/dev/null || true' EXIT INT TERM
  stty -echo
  IFS= read -r secret
  stty echo
  trap - EXIT INT TERM
  printf '\n' >&2
  printf '%s' "$secret"
}

write_public_env() {
  local supabase_url="${1%/}"
  local publishable_key="$2"
  local public_app_url="${3%/}"

  umask 077
  cat > "$INTERACT_ROOT/.env" <<EOF
VITE_SUPABASE_URL=$supabase_url
VITE_SUPABASE_ANON_KEY=$publishable_key
VITE_PUBLIC_APP_URL=$public_app_url
EOF
}
