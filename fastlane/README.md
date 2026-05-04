# Fastlane setup

See [`docs/FASTLANE.md`](../docs/FASTLANE.md) for the full walkthrough.

Quick start:

```bash
cd vitronitor
bundle install                               # installs fastlane (Gemfile)
bundle exec fastlane ios certs               # one-time: sync certs via Match
bundle exec fastlane ios beta                # build + upload to TestFlight
bundle exec fastlane ios release             # build + submit to App Store
```

Lanes are defined in `fastlane/Fastfile`. Required env vars are documented at
the top of that file.
