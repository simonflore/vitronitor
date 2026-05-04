import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor configuration.
 *
 * Placeholders to replace before shipping:
 *   - appId         → reverse-DNS bundle id (also set in Xcode + Android)
 *   - appName       → human-readable app name
 *   - ios.scheme    → custom URL scheme for deep links (oauth callbacks etc.)
 *   - server.url    → ONLY for live-reload-against-laptop dev. Comment out
 *                     for prod builds; the WebView loads bundled dist/.
 *   - CapacitorUpdater.updateUrl → your prod API URL + /api/capacitor/bundle
 *   - CapacitorUpdater.publicKey → the PEM half of your Capgo key (the
 *                                  placeholder PEM below is invalid)
 */
const config: CapacitorConfig = {
  appId: 'com.example.app',
  appName: 'Vitronitor',
  webDir: 'dist',

  ios: {
    contentInset: 'never',
    allowsLinkPreview: true,
    scheme: 'vitronitor',
    backgroundColor: '#0a0a0a',
  },

  android: {
    backgroundColor: '#0a0a0a',
  },

  // Uncomment for live-reload against your laptop. Required: set the IP to
  // your machine's LAN IP and serve `npm run dev` from there.
  // server: { url: 'http://192.168.1.10:5173', cleartext: true },

  plugins: {
    SplashScreen: {
      launchShowDuration: 0,
      launchAutoHide: false,
      backgroundColor: '#0a0a0a',
      showSpinner: false,
    },
    StatusBar: {
      overlaysWebView: true,
      style: 'DARK',
    },
    CapacitorUpdater: {
      // Self-hosted Capgo OTA. autoUpdate stays false and the placeholder
      // publicKey makes any signature verification fail (which is correct:
      // nothing should be applied until you replace it with your own key).
      autoUpdate: false,
      updateUrl: 'https://example.com/api/capacitor/bundle',
      statsUrl: '',
      channelUrl: '',
      appReadyTimeout: 15_000,
      autoDeleteFailed: true,
      autoDeletePrevious: true,
      resetWhenUpdate: true,
      // Replace with the public half of your Capgo signing key (printed by
      // scripts/setup-signing-key.sh).
      publicKey: '-----BEGIN RSA PUBLIC KEY-----\nREPLACE_WITH_YOUR_PUBLIC_KEY\n-----END RSA PUBLIC KEY-----\n',
    },
  },
};

export default config;
