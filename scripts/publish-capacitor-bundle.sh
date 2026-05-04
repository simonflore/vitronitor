#!/usr/bin/env bash
#
# Build, sign, and upload a Capacitor OTA bundle to the configured object store.
#
# Usage: npm run cap:publish-bundle
#
# Prerequisites:
#   - aws CLI configured against your S3-compatible store, OR rely on
#     AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY env vars
#   - .capgo_key_v2 in repo root (run scripts/setup-signing-key.sh once)
#   - The bundle's public key must be in capacitor.config.ts
#   - APP_ID env var (defaults to com.example.app — change to match your bundle id)
#
# What it does:
#   1. npm run build → dist/
#   2. @capgo/cli bundle zip   → creates a zip + computes plaintext SHA256
#   3. @capgo/cli bundle encrypt → RSA-signs + AES-encrypts the zip
#   4. uploads the encrypted bundle to s3://<bucket>/capacitor/bundle/bundle/<version>/bundle.zip
#   5. uploads the manifest    to s3://<bucket>/capacitor/bundle/bundle/manifest.json
#
# Devices pick up new bundles on next /api/capacitor/bundle check (~10 min).

set -euo pipefail

VERSION="${OTA_VERSION:-$(node -p "require('./package.json').version")}"
APP_ID="${APP_ID:-com.example.app}"
BUCKET="${S3_RELEASES_BUCKET:?S3_RELEASES_BUCKET is required (set in .env.local or workflow vars)}"
PREFIX="capacitor/bundle"

if [ ! -f ".capgo_key_v2" ]; then
  echo "Error: .capgo_key_v2 not found. Run: bash scripts/setup-signing-key.sh"
  exit 1
fi

if [ -z "${S3_ENDPOINT:-}" ]; then
  echo "Error: S3_ENDPOINT not set. Source .env.local or export it before running."
  exit 1
fi

echo "=== Capacitor OTA publish ==="
echo "  version : ${VERSION}"
echo "  app id  : ${APP_ID}"
echo "  bucket  : s3://${BUCKET}/${PREFIX}/"
echo ""

echo "[1/5] Building SPA…"
npm run build

echo "[2/5] Zipping bundle…"
npx @capgo/cli bundle zip "$APP_ID" --path ./dist --key-v2 --json --no-code-check > /tmp/cap-zip-output.json
ZIP_FILENAME=$(node -p "require('/tmp/cap-zip-output.json').filename")
PLAINTEXT_CHECKSUM=$(node -p "require('/tmp/cap-zip-output.json').checksum")
echo "  → ${ZIP_FILENAME}"

echo "[3/5] Encrypting + signing…"
npx @capgo/cli bundle encrypt "$ZIP_FILENAME" "$PLAINTEXT_CHECKSUM" --json > /tmp/cap-encrypt-output.json
ENCRYPTED_FILENAME=$(node -p "require('/tmp/cap-encrypt-output.json').filename")
echo "  → ${ENCRYPTED_FILENAME}"

echo "[4/5] Uploading bundle to S3…"
aws s3 cp "$ENCRYPTED_FILENAME" "s3://${BUCKET}/${PREFIX}/${VERSION}/bundle.zip" \
  --endpoint-url "$S3_ENDPOINT"

echo "[5/5] Uploading manifest…"
node -e "
  const enc = require('/tmp/cap-encrypt-output.json');
  const manifest = JSON.stringify({
    version: '${VERSION}',
    checksum: enc.checksum,
    sessionKey: enc.ivSessionKey,
    date: new Date().toISOString(),
    key: '${PREFIX}/${VERSION}/bundle.zip'
  }, null, 2);
  require('fs').writeFileSync('/tmp/cap-manifest.json', manifest);
"
aws s3 cp /tmp/cap-manifest.json "s3://${BUCKET}/${PREFIX}/manifest.json" \
  --endpoint-url "$S3_ENDPOINT" --content-type "application/json"

rm -f "$ZIP_FILENAME" "$ENCRYPTED_FILENAME" /tmp/cap-zip-output.json /tmp/cap-encrypt-output.json /tmp/cap-manifest.json

echo ""
echo "✓ Published v${VERSION} to s3://${BUCKET}/${PREFIX}/${VERSION}/bundle.zip"
echo "  Devices will pick this up within ~10 min."
