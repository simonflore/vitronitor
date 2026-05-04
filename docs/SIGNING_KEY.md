# OTA signing key

Both OTA pipelines — Capacitor (iOS/Android, M6) and Electron renderer
(M9) — RSA-sign every bundle they ship. Devices verify the signature
against an embedded public key (`capacitor.config.ts` for Capacitor,
`electron/main/renderer-ota.ts` for Electron). Without a matching key
pair, the device rejects the bundle.

The same `.capgo_key_v2` file signs both — one key, both platforms.

This is the security boundary: even if your S3 bucket is compromised, an
attacker can't forge a valid bundle without the private key.

## 1. Generate the key

Once, on a developer machine:

```bash
bash scripts/setup-signing-key.sh
```

This:
- Runs `npx @capgo/cli key create`
- Writes `.capgo_key_v2` to the project root (gitignored)
- Prints the matching public PEM
- Refuses to overwrite an existing key (rotation = native release with new pubkey)

## 2. Paste the public key into the app

Open `capacitor.config.ts` and replace the placeholder `publicKey` with the
PEM you just printed. **Both** the BEGIN/END lines must be present. Same key
goes into `electron/main/renderer-ota.ts` (`PUBLIC_KEY_PEM` constant added in M9).

## 3. Add the private key to CI secrets

GitHub → Settings → Secrets and variables → Actions:

- Secret `CAPGO_PRIVATE_KEY_V2` — paste the *full contents* of `.capgo_key_v2`
  (including BEGIN/END lines).

The `.github/workflows/capacitor-bundle.yml` workflow writes this secret back to
`.capgo_key_v2` at the start of each run, then publishes.

Also set:

- Variable `APP_ID` — your bundle id (e.g. `com.yourcompany.yourapp`)
- Variable `S3_RELEASES_BUCKET` — your bucket name (defaults to `releases`)
- Secret `S3_ENDPOINT`
- Secret `S3_ACCESS_KEY_ID`
- Secret `S3_SECRET_ACCESS_KEY`
- Secret `VITE_SUPABASE_URL`
- Secret `VITE_SUPABASE_ANON_KEY`

## 4. Back up the key

If you lose `.capgo_key_v2` you can never publish another OTA bundle for the
current public key. Recovery:

1. Generate a new key pair.
2. Update `capacitor.config.ts` and `electron/main/renderer-ota.ts` with the
   new public PEM.
3. Ship a **native** App Store update so devices pick up the new public key.
4. Resume OTA publishing.

Treat the key like any other production secret. A 1Password / Bitwarden
secure note + a copy on hardware-encrypted offline storage is a reasonable
approach.

## 5. Rotation

There's no in-band rotation — the embedded public key is what verifies the
bundle. To rotate, follow the recovery steps above. Plan rotations to align
with planned native releases.
