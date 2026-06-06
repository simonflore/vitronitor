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
#   1. npm run build → dist/   (skip with SKIP_CAPACITOR_BUILD=1 to reuse dist/)
#   2. @capgo/cli bundle zip   → creates a zip + computes plaintext SHA256
#   3. @capgo/cli bundle encrypt → RSA-signs + AES-encrypts the zip
#   4. uploads the encrypted bundle to s3://<bucket>/capacitor/bundle/bundle/<version>/bundle.zip
#   5. uploads the manifest    to s3://<bucket>/capacitor/bundle/bundle/manifest.json
#
# Env knobs:
#   SKIP_CAPACITOR_BUILD=1   reuse an existing dist/ (e.g. CI built it already)
#   APP_ID                   bundle id (default com.example.app)
#   OTA_VERSION              override the published version (default package.json)
#
# Devices pick up new bundles on next /api/capacitor/bundle check (~10 min).

set -euo pipefail

VERSION="${OTA_VERSION:-$(node -p "require('./package.json').version")}"
APP_ID="${APP_ID:-com.example.app}"
BUCKET="${S3_RELEASES_BUCKET:?S3_RELEASES_BUCKET is required (set in .env.local or workflow vars)}"
PREFIX="capacitor/bundle"

# Floor native (Xcode MARKETING_VERSION) version this JS bundle requires. The
# server advertises it in the manifest; a shell older than this should ignore
# the bundle. Pin it higher than the build version via the
# `capacitor.minNativeVersion` package.json field when a bundle starts
# depending on a newly-added native plugin or peer dep — otherwise an old shell
# would OTA into JS that calls a plugin it doesn't have. Defaults to "the shell
# built today" (the current package.json version).
MIN_NATIVE_VERSION="$(node -p "require('./package.json').capacitor?.minNativeVersion || require('./package.json').version")"

if [ ! -f ".capgo_key_v2" ]; then
  echo "Error: .capgo_key_v2 not found. Run: bash scripts/setup-signing-key.sh"
  exit 1
fi

if [ -z "${S3_ENDPOINT:-}" ]; then
  echo "Error: S3_ENDPOINT not set. Source .env.local or export it before running."
  exit 1
fi

echo "=== Capacitor OTA publish ==="
echo "  version     : ${VERSION}"
echo "  app id      : ${APP_ID}"
echo "  min native  : ${MIN_NATIVE_VERSION}"
echo "  bucket      : s3://${BUCKET}/${PREFIX}/"
echo ""

if [ "${SKIP_CAPACITOR_BUILD:-0}" = "1" ]; then
  echo "[1/5] Building SPA… skipped (SKIP_CAPACITOR_BUILD=1, reusing dist/)"
  if [ ! -d "dist" ]; then
    echo "Error: SKIP_CAPACITOR_BUILD=1 but dist/ does not exist."
    exit 1
  fi
else
  echo "[1/5] Building SPA…"
  # Scrub signing + S3 secrets from the build's environment — the Vite build
  # never needs them, and a compromised build dependency shouldn't be able to
  # read the OTA signing key or upload credentials.
  env \
    -u AWS_ACCESS_KEY_ID \
    -u AWS_SECRET_ACCESS_KEY \
    -u AWS_SESSION_TOKEN \
    -u S3_ENDPOINT \
    -u S3_RELEASES_BUCKET \
    npm run build
fi

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
VERSION="$VERSION" MIN_NATIVE_VERSION="$MIN_NATIVE_VERSION" PREFIX="$PREFIX" node -e "
  const enc = require('/tmp/cap-encrypt-output.json');
  const manifest = JSON.stringify({
    version: process.env.VERSION,
    checksum: enc.checksum,
    sessionKey: enc.ivSessionKey,
    min_native_version: process.env.MIN_NATIVE_VERSION,
    date: new Date().toISOString(),
    key: process.env.PREFIX + '/' + process.env.VERSION + '/bundle.zip'
  }, null, 2);
  require('fs').writeFileSync('/tmp/cap-manifest.json', manifest);
"
aws s3 cp /tmp/cap-manifest.json "s3://${BUCKET}/${PREFIX}/manifest.json" \
  --endpoint-url "$S3_ENDPOINT" --content-type "application/json"

rm -f "$ZIP_FILENAME" "$ENCRYPTED_FILENAME" /tmp/cap-zip-output.json /tmp/cap-encrypt-output.json /tmp/cap-manifest.json

echo ""
echo "✓ Published v${VERSION} (min native ${MIN_NATIVE_VERSION}) to s3://${BUCKET}/${PREFIX}/${VERSION}/bundle.zip"
echo "  Devices will pick this up within ~10 min."
