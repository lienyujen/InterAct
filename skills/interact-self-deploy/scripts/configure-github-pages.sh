#!/usr/bin/env bash

set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

if [[ $# -ne 4 ]]; then
  echo "Usage: $0 OWNER/REPOSITORY SUPABASE_URL PUBLISHABLE_KEY PUBLIC_APP_URL" >&2
  exit 1
fi

REPOSITORY="$1"
SUPABASE_URL="${2%/}"
PUBLISHABLE_KEY="$3"
PUBLIC_APP_URL="${4%/}"

if [[ ! "$REPOSITORY" =~ ^[^/[:space:]]+/[^/[:space:]]+$ ]]; then
  echo "Repository must use OWNER/REPOSITORY format." >&2
  exit 1
fi
if [[ ! "$SUPABASE_URL" =~ ^https://[a-z0-9]+\.supabase\.co$ ]]; then
  echo "Supabase URL must look like https://PROJECT_REF.supabase.co" >&2
  exit 1
fi
if [[ "$PUBLISHABLE_KEY" == *dashboard* || "$PUBLISHABLE_KEY" =~ ^https?:// ]]; then
  echo "Publishable key must be a Supabase publishable key, not a URL." >&2
  exit 1
fi
if [[ ! "$PUBLIC_APP_URL" =~ ^https:// ]]; then
  echo "Public app URL must start with https://" >&2
  exit 1
fi

require_command gh
gh auth status

gh variable set VITE_SUPABASE_URL -R "$REPOSITORY" --body "$SUPABASE_URL"
gh variable set VITE_SUPABASE_ANON_KEY -R "$REPOSITORY" --body "$PUBLISHABLE_KEY"
gh variable set VITE_PUBLIC_APP_URL -R "$REPOSITORY" --body "$PUBLIC_APP_URL"

if gh api "repos/$REPOSITORY/pages" >/dev/null 2>&1; then
  PAGES_METHOD=PATCH
else
  PAGES_METHOD=POST
fi

if ! gh api --method "$PAGES_METHOD" "repos/$REPOSITORY/pages" -f build_type=workflow >/dev/null; then
  echo "Warning: Select GitHub Actions under Repository Settings > Pages before continuing." >&2
fi

gh workflow run deploy.yml -R "$REPOSITORY"
echo "GitHub variables are set and the Pages workflow was started."
