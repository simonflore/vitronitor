#!/usr/bin/env bash
#
# Generate the RSA key pair used to sign Capgo OTA bundles.
#
# After running:
#   1. .capgo_key_v2 is written to project root (gitignored)
#   2. The matching public key is printed
#   3. You manually paste the public key into:
#        - capacitor.config.ts → CapacitorUpdater.publicKey
#        - electron/main/renderer-ota.ts → PUBLIC_KEY_PEM (M9)
#
# IMPORTANT: lose this key, lose your ability to publish updates. Back it up.
# Rotation = ship a forced native (App Store) update with a new public key.
#
# CI: copy the .capgo_key_v2 contents into a GitHub secret (CAPGO_PRIVATE_KEY_V2);
# capacitor-bundle.yml writes the secret back to .capgo_key_v2 at the start of each run.

set -euo pipefail

KEY_FILE=".capgo_key_v2"

if [ -f "$KEY_FILE" ]; then
  echo "Refusing to overwrite existing $KEY_FILE."
  echo "If you really want to regenerate, delete it first AND remember to roll the public key everywhere."
  exit 1
fi

if ! command -v npx >/dev/null; then
  echo "Error: npx not found (install Node.js first)."
  exit 1
fi

echo "Generating new Capgo signing key…"
npx --yes @capgo/cli@latest key create

if [ ! -f "$KEY_FILE" ]; then
  echo "Error: @capgo/cli did not produce $KEY_FILE — aborting."
  exit 1
fi

PUB_KEY_FILE=".capgo_key_v2.pub"
if [ ! -f "$PUB_KEY_FILE" ]; then
  echo "Warning: $PUB_KEY_FILE not found. The public key should have been printed above."
else
  echo ""
  echo "==================== PUBLIC KEY ===================="
  cat "$PUB_KEY_FILE"
  echo "===================================================="
  echo ""
  echo "Paste this PEM into BOTH:"
  echo "  - capacitor.config.ts        → CapacitorUpdater.publicKey"
  echo "  - electron/main/renderer-ota.ts → PUBLIC_KEY_PEM   (added in M9)"
  echo ""
  echo "Add CAPGO_PRIVATE_KEY_V2 to your GitHub repo secrets — paste the FULL contents of $KEY_FILE."
fi
