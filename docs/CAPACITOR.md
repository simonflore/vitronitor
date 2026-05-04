# Capacitor (iOS / Android)

Capacitor wraps the Vite SPA in a native shell. The same React app runs on
web, iOS, Android, and Electron.

## Prerequisites

- macOS for iOS builds (Xcode 15+, CocoaPods).
- Linux/macOS for Android builds (Android Studio + JDK 17).
- Ruby 3.x for Fastlane (a `Gemfile` is included).

## 1. Add iOS

The boilerplate doesn't ship with `ios/` — it would bake your app id into
the project file. Generate it once:

```bash
cd vitronitor
npm install
npm run build:capacitor       # build the SPA into dist/
npx cap add ios               # creates ios/ from capacitor.config.ts
```

Edit `capacitor.config.ts` first if you want a non-placeholder bundle id:

```ts
const config: CapacitorConfig = {
  appId: 'com.yourcompany.yourapp',   // ← reverse DNS bundle id
  appName: 'Your App',
  ios: { scheme: 'yourapp' },         // ← OAuth/deep-link scheme
  // ...
};
```

After every edit to `capacitor.config.ts`, re-run `npx cap sync` (or just
`npm run cap:sync` which also runs `scripts/register-capacitor-plugins.js`).

## 2. Open in Xcode + run on simulator

```bash
npm run cap:open:ios
```

In Xcode:
1. Pick a simulator (iPhone 15 Pro is fine).
2. Cmd+R to build & run.
3. The app loads `dist/index.html` from the bundle.

If you need live reload against your laptop while developing:

```bash
# 1. uncomment the `server.url` line in capacitor.config.ts and set your LAN IP
# 2. start the dev server
npm run dev
# 3. rebuild + sync + open
npm run cap:sync:dev && npm run cap:open:ios
```

## 3. Add Android

```bash
npx cap add android
```

Open in Android Studio:

```bash
npm run cap:open:android
```

Run on an emulator (Pixel 7 + API 34 is a good baseline). The Android
manifest already has internet permission via Capacitor defaults.

The Capgo OTA pipeline works the same on Android — same
`.capgo_key_v2` signs the bundle, same `POST /api/capacitor/bundle` endpoint,
same `publish-capacitor-bundle.sh`. After your first manual install via
Android Studio (or the Play Store), subsequent JS-only updates ship via
OTA.

For Play Store releases, set up [Fastlane Supply](https://docs.fastlane.tools/getting-started/android/setup/)
in `fastlane/Fastfile` (the iOS lanes are documented in `FASTLANE.md`;
add `:android` lanes alongside).

## 4. Custom plugins

The boilerplate ships **no custom plugins**. To add one, use Capacitor's
official scaffold:

```bash
npm init @capacitor/plugin@latest
# → asks for plugin name, package id, etc.
# → creates plugins/your-plugin/{src,ios,android,...}
```

Then register it in `scripts/register-capacitor-plugins.js` so `npm run cap:sync`
keeps the registration alive:

```js
const CUSTOM_PLUGINS = [
  {
    packageName: 'CapacitorYourPlugin',
    productName: 'YourPlugin',
    path: '../../../plugins/capacitor-your-plugin',
    androidClasspath: 'com.example.yourplugin.YourPlugin',
    platforms: ['ios', 'android'],
  },
];
```

The script edits four files Capacitor regenerates on every `cap sync`:

- `ios/App/App/capacitor.config.json` (plugin class list)
- `ios/App/CapApp-SPM/Package.swift` (Swift package + product entries)
- `android/app/src/main/assets/capacitor.plugins.json`
- `android/capacitor.settings.gradle`
- `android/app/capacitor.build.gradle`

Without the script, every `cap sync` would silently strip your plugin
registrations.

## 5. Native auth + network

The boilerplate already swaps two things on Capacitor:

- **Auth storage** — `lib/supabase/client.ts` uses `@capacitor/preferences`
  (UserDefaults / SharedPrefs) instead of localStorage so sessions survive
  WebView eviction. See `lib/supabase/native-storage.ts`.
- **Network status** — `lib/contexts/NetworkContext.tsx` uses
  `@capacitor/network` alongside `navigator.onLine` (Capacitor's plugin is
  more reliable on cellular ↔ wifi switches).

## 6. Magic-link callback (deep linking)

Supabase magic links redirect to `https://<your-host>/#/auth/callback` by
default. On native that's a web URL — it opens Safari, not your app.

Two ways to fix:

1. **Universal Links** (recommended): host an
   `apple-app-site-association` JSON at your domain root listing the
   `applinks:<bundle-id>` entry. Tap on the magic link → iOS opens your app
   directly.

2. **Custom URL scheme**: change Supabase's `emailRedirectTo` to
   `vitronitor://auth/callback` (or whatever scheme you set in
   `capacitor.config.ts`). Less polished UX but works without server
   configuration.

The `signInWithEmail` call in `lib/contexts/AuthContext.tsx` currently uses
`window.location.origin + '/#/auth/callback'`. Update that to your scheme
or universal link before shipping.

## 7. iOS release

See [`FASTLANE.md`](./FASTLANE.md) for the full release pipeline. Quick
sanity test from a fresh checkout:

```bash
bundle install
bundle exec fastlane ios certs       # syncs certs via Match (one-time)
bundle exec fastlane ios beta        # build + upload to TestFlight
```

## 8. Capgo OTA

The `CapacitorUpdater` plugin is already configured in `capacitor.config.ts`
with `autoUpdate: false` and a placeholder public key. The self-hosted OTA
pipeline (S3 + signing key + server endpoint) drives the live update flow;
until those are wired up, the plugin is dormant — first install must come
from Xcode/TestFlight.
