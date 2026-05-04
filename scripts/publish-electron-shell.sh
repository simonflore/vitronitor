#!/usr/bin/env bash
#
# Upload built Electron shell artifacts to the object store.
#
# Usage:
#   bash scripts/publish-electron-shell.sh mac     # macOS arm64
#   bash scripts/publish-electron-shell.sh win     # Windows x64
#   bash scripts/publish-electron-shell.sh linux   # Linux x64
#
# Prerequisites:
#   - Run npm run electron:build first; artifacts land in dist-electron/
#   - aws CLI configured against $S3_ENDPOINT, OR rely on AWS_ACCESS_KEY_ID +
#     AWS_SECRET_ACCESS_KEY env vars
#   - PRODUCT_NAME env var to pick the right artifact filenames (defaults to
#     "Vitronitor" — match electron-builder.config.cjs productName)
#
# When to run this manually:
#   - electron/main/** changed (anything in the binary, not just renderer)
#   - native deps bumped (better-sqlite3, electron version, etc.)
#   - electron-builder.config.cjs changed
#
# Renderer-only changes go through the M9 path
# (scripts/publish-electron-bundle.sh) — much faster, no native rebuild.

set -euo pipefail

PLATFORM="${1:-mac}"
PRODUCT_NAME="${PRODUCT_NAME:-Vitronitor}"
VERSION=$(node -p "require('./package.json').version")
BUCKET="${S3_RELEASES_BUCKET:?S3_RELEASES_BUCKET is required (set in .env.local or workflow vars)}"
PREFIX="electron/shell"
DIST_DIR="dist-electron"

if [ ! -d "$DIST_DIR" ]; then
  echo "Error: $DIST_DIR/ not found. Run 'npm run electron:build' first."
  exit 1
fi
if [ -z "${S3_ENDPOINT:-}" ]; then
  echo "Error: S3_ENDPOINT not set. Source .env.local first."
  exit 1
fi

echo "=== Electron shell publish ==="
echo "  platform: ${PLATFORM}"
echo "  version : ${VERSION}"
echo "  bucket  : s3://${BUCKET}/${PREFIX}/"
echo ""

upload_yml() {
  local name="$1"
  local p="${DIST_DIR}/${name}"
  if [ ! -f "$p" ]; then
    echo "  (skip — ${name} not found)"
    return 0
  fi
  echo "  → ${name} (no-cache)"
  aws s3 cp "$p" "s3://${BUCKET}/${PREFIX}/${name}" \
    --endpoint-url "$S3_ENDPOINT" \
    --content-type "application/x-yaml" \
    --cache-control "no-cache, no-store, must-revalidate"
}

upload_bin() {
  local name="$1"
  local p="${DIST_DIR}/${name}"
  if [ ! -f "$p" ]; then
    echo "  (skip — ${name} not found)"
    return 0
  fi
  echo "  → ${name}"
  aws s3 cp "$p" "s3://${BUCKET}/${PREFIX}/${name}" --endpoint-url "$S3_ENDPOINT"
}

case "$PLATFORM" in
  mac)
    upload_yml "latest-mac.yml"
    upload_bin "${PRODUCT_NAME}-${VERSION}-arm64.dmg"
    upload_bin "${PRODUCT_NAME}-${VERSION}-arm64-mac.zip"
    upload_bin "${PRODUCT_NAME}-${VERSION}-arm64.dmg.blockmap"
    upload_bin "${PRODUCT_NAME}-${VERSION}-arm64-mac.zip.blockmap"
    ;;
  win)
    upload_yml "latest.yml"
    upload_bin "${PRODUCT_NAME} Setup ${VERSION}.exe"
    upload_bin "${PRODUCT_NAME} Setup ${VERSION}.exe.blockmap"
    ;;
  linux)
    upload_yml "latest-linux.yml"
    upload_bin "${PRODUCT_NAME}-${VERSION}.AppImage"
    ;;
  *)
    echo "Error: unknown platform '${PLATFORM}' (expected: mac, win, linux)"
    exit 1
    ;;
esac

echo ""
echo "✓ Published ${PLATFORM} shell v${VERSION} to s3://${BUCKET}/${PREFIX}/"
