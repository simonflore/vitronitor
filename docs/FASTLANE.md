# Fastlane (iOS releases)

Fastlane orchestrates Xcode → TestFlight → App Store. The Vitronitor boilerplate
ships three lanes:

- `fastlane ios certs`   — one-time cert sync via Match
- `fastlane ios beta`    — build + upload to TestFlight
- `fastlane ios release` — build + submit for App Store review

## Prerequisites

- Apple Developer Program membership ($99/year)
- App Store Connect API key (preferred over password auth):
  - https://appstoreconnect.apple.com → Users and Access → Keys
  - Create a key with the "App Manager" role
  - Download the `.p8` file (one chance — keep it safe)
  - Note the Key ID and Issuer ID
- A private git repo for Fastlane Match (encrypted certs + profiles).
  Pattern: a `match-certs` branch in this repo, or a sibling repo.
- Ruby 3.x + Bundler (`gem install bundler`).

## One-time setup

```bash
cd vitronitor
bundle install                # installs fastlane from Gemfile
```

Edit `fastlane/Appfile` with your real values (or set the env vars):

```bash
APPLE_ID=you@example.com
APP_IDENTIFIER=com.yourcompany.yourapp
TEAM_ID=ABCDE12345
ITC_TEAM_ID=12345678
```

Edit `fastlane/Matchfile`:

```bash
MATCH_GIT_URL=git@github.com:yourorg/your-certs-repo.git
MATCH_PASSWORD=<choose a strong passphrase>
```

Initialize Match (creates the cert repo if empty):

```bash
bundle exec fastlane match development
bundle exec fastlane match appstore
```

For CI, set the App Store Connect API key envs:

```bash
APPLE_API_KEY_ID=ABC123XYZ
APPLE_API_ISSUER_ID=12345678-1234-1234-1234-123456789abc
APPLE_API_KEY_PATH=./AuthKey_ABC123XYZ.p8
```

## Build & release flow

```bash
# Daily TestFlight build
bundle exec fastlane ios beta

# App Store submission (release notes from fastlane/metadata if present)
bundle exec fastlane ios release
```

Each lane:
1. Runs `npm run cap:sync` so the latest SPA is bundled.
2. Resolves the cert + profile via Match.
3. Bumps build number (timestamp `YYYYMMDDHHmm` so collisions are impossible).
4. Builds the IPA via `gym`.
5. Uploads via `pilot` (TestFlight) or `deliver` (App Store).

## Common errors

- **"No matching profile" / "Provisioning profile doesn't include device"**
  → run `fastlane ios certs` again; the profile may have expired or you
  added a new device.
- **"Invalid signing identity"** → Keychain access might be locked. On CI,
  run `setup_ci` at the top of the lane (Fastlane creates a temporary
  keychain).
- **"App Store Connect API key not found"** → check `APPLE_API_KEY_PATH`
  is an absolute path that the runner can read.
- **"Bundle id mismatch"** → make sure `appId` in `capacitor.config.ts`,
  `app_identifier` in `Appfile`, and the Xcode bundle id all match. Run
  `npm run cap:sync` after fixing.

## Metadata + screenshots (optional)

Fastlane can manage your App Store listing too. Generate the metadata
folder once:

```bash
bundle exec fastlane deliver init
```

This creates `fastlane/metadata/<locale>/{name,subtitle,description,...}.txt`.
Edit, then `fastlane ios release` will sync the changes on the next
submission.

For screenshots, drop PNGs in `fastlane/screenshots/<locale>/` matching
Apple's required sizes.
