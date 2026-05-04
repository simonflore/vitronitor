# Object store setup (M6 / M8 / M9)

The OTA pipelines (iOS Capgo, Electron shell, Electron renderer) all write to
an S3-compatible object store. Vitronitor is tested against:

- **AWS S3** (canonical)
- **Cloudflare R2** (cheap egress; requires a custom domain to use the public
  download URL we serve via Hono)
- **MinIO** (self-host)
- **Garage** (self-host; the boilerplate's `lib/object-storage.ts` already includes
  the `requestChecksumCalculation: 'WHEN_REQUIRED'` quirk Garage requires)

Pick whichever you already operate.

## Bucket layout

A single bucket holds all OTA artifacts. The default name is `releases`;
override via `S3_RELEASES_BUCKET` env var.

```
<bucket>/
├── capacitor/
│   └── bundle/                       # M6 — iOS Capacitor JS bundle OTA
│       ├── manifest.json             # current version pointer (cached 60s server-side)
│       └── <version>/bundle.zip      # RSA-signed AES-encrypted bundle
└── electron/
    ├── bundle/                       # M9 — Electron renderer JS bundle OTA
    │   ├── manifest.json
    │   └── <version>/bundle.zip
    └── shell/                        # M8 — electron-updater installers
        ├── latest-mac.yml
        ├── latest-linux.yml
        ├── latest.yml                # windows
        └── <name>-<version>-*.{dmg,zip,exe,AppImage,blockmap}
```

## Bucket policy

The bundles are private (presigned URLs handle access). The Hono server
generates presigned GET URLs on the fly. So no public-read policy needed.

For S3:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyPublicAccess",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:*",
      "Resource": ["arn:aws:s3:::releases/*"],
      "Condition": { "BoolIfExists": { "aws:SecureTransport": "false" } }
    }
  ]
}
```

## Env vars

```env
S3_ENDPOINT=https://s3.eu-west-1.amazonaws.com
S3_REGION=eu-west-1                # or "auto" for R2
S3_ACCESS_KEY_ID=AKIA...
S3_SECRET_ACCESS_KEY=...
S3_RELEASES_BUCKET=releases        # default
```

For R2 the endpoint is `https://<account>.r2.cloudflarestorage.com` with
`region=auto`. For Garage / MinIO use your local URL.

## Garage quirk (lib/object-storage.ts handles it)

AWS SDK v3.600+ adds CRC32 checksums by default. Garage rejects them with
`InvalidDigest`. The boilerplate's S3 client sets:

```ts
requestChecksumCalculation: 'WHEN_REQUIRED',
responseChecksumValidation: 'WHEN_REQUIRED',
```

Safe on AWS S3 + R2 + MinIO (they ignore checksums when not requested).

## Smoke test

Once you've populated the env vars:

```bash
bash scripts/setup-signing-key.sh        # only first time
npm run cap:publish-bundle             # builds + signs + uploads
aws s3 ls s3://releases/capacitor/bundle/ --endpoint-url $S3_ENDPOINT
# → should show the new <version>/ directory and an updated manifest.json
```

Then call the endpoint directly:

```bash
curl -X POST https://localhost:3000/api/capacitor/bundle \
  -H "Content-Type: application/json" \
  -d '{"version_name":"0.0.1","version_build":"0.0.1","platform":"ios"}'

# → { "version": "...", "url": "...presigned...", "checksum": "...", "session_key": "..." }
```
