# AGENTS.md

Supplement to `CLAUDE.md`. Keep this file narrow: only repo-backed agent workflows and commands that are easy to miss.

## Additional Commands

```bash
npm run test:coverage         # vitest with v8 coverage (what CI runs)
npm run electron:build-main   # compile the Electron main process only
npm run electron:build:mac:dev  # unsigned local mac build
npm run cap:publish-bundle    # sign + upload a Capgo OTA bundle
npm run electron:publish-bundle # sign + upload an Electron renderer OTA bundle
bash scripts/setup.sh         # one-time: app id / scheme / API URL
bash scripts/setup-signing-key.sh # one-time: OTA signing key
```

## Reference backend

`examples/server-hono/` is its own npm package (own lockfile, own `.env.example`). Run its commands from that directory. It imports a few root modules by relative path (`lib/sync/config.ts`, `lib/db/types/`), which is why knip treats those as entries.

## Repo Agent Workflows

- `/pick-issue [number]` (`.claude/commands/pick-issue.md`): one GitHub issue at a time, branch from `origin/main`, minimum diff, run every gate (`npm run lint`, `npm run typecheck`, `npm run test:run`, `npm run knip`), open a draft PR. Escalate for security issues, sync/OTA protocol changes, or diffs over about five files.
- `/codex-review` (`.claude/skills/codex-review/SKILL.md`): working through automated review findings on a PR.

## Backporting from gigmeister

Branch as `backport/gigmeister-<topic>`. Port the generalisable part only: strip band/org-specific logic, Sentry calls and server code that has no counterpart here. Name the gigmeister PR in the commit body.
