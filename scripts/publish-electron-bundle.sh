#!/usr/bin/env bash
#
# Build, sign, and upload an Electron renderer OTA bundle.
#
# Mirrors scripts/publish-capacitor-bundle.sh but writes to the
# electron/bundle/ prefix and includes a min_native_version field so
# bundles can refuse to apply on older shell versions.
#
# Usage: npm run electron:publish-bundle
#
# Prerequisites:
#   - aws CLI configured against $S3_ENDPOINT, OR rely on AWS_ACCESS_KEY_ID +
#     AWS_SECRET_ACCESS_KEY env vars
#   - .capgo_key_v2 in repo root (same key as iOS Capgo)
#   - The matching public key MUST already be in electron/main/renderer-ota.ts
#     as PUBLIC_KEY_PEM (same PEM that's in capacitor.config.ts)
#   - APP_ID env var (defaults to com.example.app — change to match)
#
# Bundle versioning:
#   - OTA_VERSION env var (CI sets it to <major>.<minor>.<commit-count>);
#     falls back to package.json version for manual runs.
#
# Native floor:
#   - MIN_NATIVE_VERSION env var, OR package.json.electron.minRendererNativeVersion,
#     OR package.json.version. Renderer bundles older than this won't apply.

set -euo pipefail

VERSION="${OTA_VERSION:-$(node -p "require('./package.json').version")}"
APP_ID="${APP_ID:-com.example.app}"
BUCKET="${S3_RELEASES_BUCKET:?S3_RELEASES_BUCKET is required (set in .env.local or workflow vars)}"
PREFIX="electron/bundle"
MIN_NATIVE_VERSION="${MIN_NATIVE_VERSION:-$(node -p "require('./package.json').electron?.minRendererNativeVersion ?? require('./package.json').version")}"

if [ ! -f ".capgo_key_v2" ]; then
  echo "Error: .capgo_key_v2 not found. Run: bash scripts/setup-signing-key.sh"
  exit 1
fi

if [ -z "${S3_ENDPOINT:-}" ]; then
  echo "Error: S3_ENDPOINT not set. Source .env.local or export it before running."
  exit 1
fi

# Loud warning if the public key in renderer-ota.ts is still the placeholder.
if grep -q "REPLACE_WITH_YOUR_PUBLIC_KEY" electron/main/renderer-ota.ts 2>/dev/null; then
  echo ""
  echo "WARNING: electron/main/renderer-ota.ts still has the placeholder public key."
  echo "Devices won't accept the bundle until you replace PUBLIC_KEY_PEM with the"
  echo "PEM printed by 'bash scripts/setup-signing-key.sh' (same one in capacitor.config.ts)."
  echo ""
fi

echo "=== Electron renderer OTA publish ==="
echo "  version          : ${VERSION}"
echo "  min_native_version: ${MIN_NATIVE_VERSION}"
echo "  app id            : ${APP_ID}"
echo "  bucket            : s3://${BUCKET}/${PREFIX}/"
echo ""

echo "[1/5] Building SPA…"
npm run build

echo "[2/5] Zipping bundle…"
npx @capgo/cli bundle zip "$APP_ID" --path ./dist --key-v2 --json --no-code-check > /tmp/eot-zip-output.json
ZIP_FILENAME=$(node -p "require('/tmp/eot-zip-output.json').filename")
PLAINTEXT_CHECKSUM=$(node -p "require('/tmp/eot-zip-output.json').checksum")
echo "  → ${ZIP_FILENAME}"

echo "[3/5] Encrypting + signing…"
npx @capgo/cli bundle encrypt "$ZIP_FILENAME" "$PLAINTEXT_CHECKSUM" --json > /tmp/eot-encrypt-output.json
ENCRYPTED_FILENAME=$(node -p "require('/tmp/eot-encrypt-output.json').filename")
echo "  → ${ENCRYPTED_FILENAME}"

echo "[4/5] Uploading bundle to S3…"
aws s3 cp "$ENCRYPTED_FILENAME" "s3://${BUCKET}/${PREFIX}/${VERSION}/bundle.zip" \
  --endpoint-url "$S3_ENDPOINT"

echo "[5/5] Uploading manifest…"
node -e "
  const enc = require('/tmp/eot-encrypt-output.json');
  const manifest = JSON.stringify({
    version: '${VERSION}',
    checksum: enc.checksum,
    sessionKey: enc.ivSessionKey,
    date: new Date().toISOString(),
    key: '${PREFIX}/${VERSION}/bundle.zip',
    min_native_version: '${MIN_NATIVE_VERSION}'
  }, null, 2);
  require('fs').writeFileSync('/tmp/eot-manifest.json', manifest);
"
aws s3 cp /tmp/eot-manifest.json "s3://${BUCKET}/${PREFIX}/manifest.json" \
  --endpoint-url "$S3_ENDPOINT" --content-type "application/json"

rm -f "$ZIP_FILENAME" "$ENCRYPTED_FILENAME" /tmp/eot-zip-output.json /tmp/eot-encrypt-output.json /tmp/eot-manifest.json

echo ""
echo "✓ Published renderer v${VERSION} to s3://${BUCKET}/${PREFIX}/${VERSION}/bundle.zip"
echo "  Min native version: ${MIN_NATIVE_VERSION}"
echo "  Installed Electron apps will pick this up on next launch (~30s post-boot check)."
