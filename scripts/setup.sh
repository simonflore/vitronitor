#!/usr/bin/env bash
#
# One-time interactive setup. Replaces the placeholder strings (com.example.app,
# vitronitor://, https://example.com, Vitronitor, ...) across the tree with values
# you provide.
#
# Safe to re-run — `sed` replacements are idempotent, but if you've edited
# the placeholders manually you may want to skip and `git grep example` to
# find anything you missed.

set -euo pipefail

cd "$(dirname "$0")/.."

echo "=== Vitronitor setup ==="
echo ""
echo "This script rewrites placeholder strings (app id, URL scheme, API URL, app name)"
echo "across the tree. Run from a clean checkout. You can rerun anytime."
echo ""

read -rp "App display name [MyApp]: " APP_NAME
APP_NAME="${APP_NAME:-MyApp}"

read -rp "App identifier (reverse-DNS bundle id) [com.example.${APP_NAME,,}]: " APP_ID
APP_ID="${APP_ID:-com.example.${APP_NAME,,}}"

read -rp "Custom URL scheme (for OAuth/deep links) [${APP_NAME,,}]: " URL_SCHEME
URL_SCHEME="${URL_SCHEME:-${APP_NAME,,}}"

read -rp "Production API URL (e.g. https://yourapp.com) [https://example.com]: " API_URL
API_URL="${API_URL:-https://example.com}"

echo ""
echo "Will rewrite:"
echo "  App name      'Vitronitor'              → '${APP_NAME}'"
echo "  App id        'com.example.app'     → '${APP_ID}'"
echo "  URL scheme    'vitronitor'              → '${URL_SCHEME}'"
echo "  Production    'https://example.com' → '${API_URL}'"
echo ""
read -rp "Proceed? [y/N]: " CONFIRM
[[ "$CONFIRM" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 0; }

# Files we touch. Excluding node_modules, .git, dist, ios/, android/, vendor/,
# and binary blobs.
FILES=$(grep -rl -e 'com\.example\.app' \
                  -e 'vitronitor://' \
                  -e "vitronitor'" \
                  -e 'https://example\.com' \
                  -e '"Vitronitor"' \
                  -e 'name="Vitronitor"' \
                  --include='*.ts' --include='*.tsx' --include='*.js' --include='*.cjs' \
                  --include='*.mjs' --include='*.json' --include='*.html' --include='*.md' \
                  --include='*.swift' --include='*.gradle' --include='*.plist' \
                  --include='*.xml' --include='*.yml' --include='*.yaml' --include='Gemfile' \
                  --include='Caddyfile' --include='*.sql' --include='*.sh' \
                  . 2>/dev/null \
        | grep -v -E '/(node_modules|\.git|dist|dist-electron|ios|android|vendor|electron/dist|\.tmp)/' || true)

if [ -z "$FILES" ]; then
  echo "No files to rewrite. Already set up?"
  exit 0
fi

# BSD-compatible sed-in-place uses -i.bak. We strip the .bak after.
echo "Rewriting in $(echo "$FILES" | wc -l | tr -d ' ') files..."
echo "$FILES" | while read -r f; do
  [ -f "$f" ] || continue
  sed -i.bak \
    -e "s|com\.example\.app|${APP_ID}|g" \
    -e "s|https://example\.com|${API_URL}|g" \
    -e "s|vitronitor://|${URL_SCHEME}://|g" \
    -e "s|scheme: 'vitronitor'|scheme: '${URL_SCHEME}'|g" \
    -e "s|'vitronitor'|'${URL_SCHEME}'|g" \
    -e "s|name=\"Vitronitor\"|name=\"${APP_NAME}\"|g" \
    -e "s|\"Vitronitor\"|\"${APP_NAME}\"|g" \
    -e "s|<title>Vitronitor</title>|<title>${APP_NAME}</title>|g" \
    "$f"
  rm -f "$f.bak"
done

echo ""
echo "✓ Done."
echo ""
echo "Next steps:"
echo "  1. cp .env.example .env.local        # fill in Supabase + S3 creds"
echo "  2. npm install --legacy-peer-deps"
echo "  3. bash scripts/setup-signing-key.sh # one-time, for OTA signing"
echo "  4. npm run dev                       # Vite SPA on :5173"
echo ""
echo "Optional — bring up the reference backend (in another terminal):"
echo "  cd examples/server-hono"
echo "  cp .env.example .env.local           # fill in Supabase + Electric + S3"
echo "  npm install --legacy-peer-deps"
echo "  npm run dev                          # Hono :3001 + Caddy :3000"
echo ""
echo "NOTE: 'Vitronitor' as a substring in code comments / docs was NOT replaced."
echo "      Run 'git grep -i vitronitor' to spot anything you want to update by hand."
