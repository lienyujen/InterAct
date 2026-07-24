#!/usr/bin/env bash

set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

if [[ $# -ne 3 ]]; then
  echo "Usage: $0 SUPABASE_URL PUBLISHABLE_KEY PUBLIC_APP_URL" >&2
  exit 1
fi

SUPABASE_URL="${1%/}"
PUBLISHABLE_KEY="$2"
PUBLIC_APP_URL="${3%/}"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "A macOS build must be created on macOS." >&2
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

require_command pnpm
write_public_env "$SUPABASE_URL" "$PUBLISHABLE_KEY" "$PUBLIC_APP_URL"

cd "$INTERACT_ROOT"
pnpm install --frozen-lockfile
pnpm lint
pnpm build

# This local build is intentionally unsigned. Public distribution must use
# release-macos.yml so Gatekeeper receives a signed and notarized artifact.
CSC_IDENTITY_AUTO_DISCOVERY=false \
  pnpm exec electron-builder --mac dmg zip --universal --publish never

echo "Unsigned local test files are available under release/."
