#!/usr/bin/env bash
#
# Wrapper for `vite build` that scrubs VITE_* shell env vars first.
#
# Vite exposes process.env.VITE_* to the client bundle ON TOP of .env file
# vars, and shell wins. So `source .env.local` (commonly done before a
# publish to grab S3 / Apple creds) silently bakes localhost URLs into prod
# artifacts even though `.env.production` is also present.
#
# Production builds should read VITE_* purely from .env files. This wrapper
# unsets every VITE_* shell var before running Vite, so AWS/S3/SENTRY/APPLE
# vars stay intact for the surrounding script while Vite sees a clean env.
#
# Used by `npm run build` — touches everything that calls it (renderer OTA
# publish, electron-builder shell pipeline, Capacitor publish, manual builds).

set -euo pipefail

for v in $(env | awk -F= '/^VITE_/ {print $1}'); do
  unset "$v"
done

exec npx vite build "$@"
