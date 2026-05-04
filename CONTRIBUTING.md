# Contributing to Vitronitor

Thanks for your interest. Vitronitor is a boilerplate, so the contribution
bar is a bit different from a regular library: changes should generalize
to *any* downstream user, not just one project's needs.

By participating in this project you agree to the [Code of Conduct](./CODE_OF_CONDUCT.md).

## What's in scope

- Bug fixes anywhere in the boilerplate.
- Documentation improvements (clarity, missing context, typos).
- Cross-platform compatibility fixes (web / iOS / Android / Electron).
- Minor refactors that simplify a pattern without removing functionality.
- New milestones that fill a documented gap (push notifications, e2e
  tests, additional auth providers, etc.) — open an issue first to
  discuss the design.

## What's out of scope

- App-specific features that don't generalize (e.g. "add a chat UI").
  Fork the boilerplate and build your app there.
- Vendor lock-in (e.g. switching the canonical example from Supabase to a
  specific commercial alternative). Vitronitor stays open and swappable —
  see [`docs/BACKEND_CONTRACTS.md`](./docs/BACKEND_CONTRACTS.md) and
  [`docs/AUTH.md`](./docs/AUTH.md) for the swap seams.
- Adding heavy dependencies for marginal wins. The dep list is small on
  purpose; new deps need a strong justification.

## Reporting issues

For **security vulnerabilities**, follow [SECURITY.md](./SECURITY.md) —
do not open a public issue.

For everything else, [open an issue](../../issues/new/choose) and pick the
right template. Bug reports need a minimal reproduction; feature
requests need a problem statement before a proposed solution.

## Development setup

Full first-time setup is in [`docs/SETUP.md`](./docs/SETUP.md). The short
version:

```bash
git clone <your-fork>
cd vitronitor
bash scripts/setup.sh           # interactive: app id / scheme / API URL
cp .env.example .env.local      # fill in Supabase + S3 creds
npm install --legacy-peer-deps
npm run dev                     # Vite SPA on :5173

# In another terminal — to run the reference backend:
cd examples/server-hono
npm install --legacy-peer-deps
cp .env.example .env.local      # fill in Supabase + Electric + S3 creds
npm run dev                     # Hono :3001 + Caddy :3000
```

You'll need: Node 22+, a Supabase project, an Electric source, and an
S3-compatible bucket (the last three are free to spin up — see
[`docs/SUPABASE.md`](./docs/SUPABASE.md), [`docs/ELECTRIC.md`](./docs/ELECTRIC.md),
[`docs/OBJECT_STORE_SETUP.md`](./docs/OBJECT_STORE_SETUP.md)). Plus Caddy
(`brew install caddy && caddy trust`) if you run the reference backend.

## Local checks before opening a PR

```bash
npm run lint        # ESLint, fails on any warning
npm run typecheck   # tsc --noEmit, strict
```

Both are required green for CI to pass. There is no test suite yet —
[adding one](#whats-in-scope) is welcome.

## Pull request process

1. Fork the repo and create a topic branch off `main` (e.g.
   `fix/electron-deeplink-windows`, `feat/push-notifications`).
2. Keep PRs focused. One concern per PR — split unrelated fixes.
3. Update docs in the same PR if behavior or surface changes.
4. Run lint + typecheck locally before pushing.
5. Open the PR against `main` using the [PR template](.github/PULL_REQUEST_TEMPLATE.md).
   Fill in the linked issue, the change type, and the test plan.
6. Be ready for review feedback — most PRs need at least one revision.

## Commit messages

No strict convention. Plain English is fine. Conventional Commits
(`feat:`, `fix:`, `docs:`) are welcome but not required. The PR title is
what ends up in the merge commit, so make that descriptive.

## Coding style

- TypeScript strict mode. No `any`, no `@ts-ignore` — fix the underlying
  type. `unknown` + a narrowing check is the escape hatch.
- ESLint enforced, `--max-warnings 0`. CI fails on any warning.
- Default to writing no comments. When you do, explain *why*, not *what*.
- Prefer editing existing files to creating new ones.
- Match existing patterns (see [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)
  for the layout).

## Naming conventions

The boilerplate uses a single naming axis you should preserve:

| Concept | Vocabulary |
|---|---|
| Platforms | `capacitor` (iOS+Android) and `electron` (desktop). Don't introduce `app` / `desktop` as synonyms. |
| OTA artifacts | `bundle` (JS payload, hot-swappable) and `shell` (native installer). Don't introduce `update` / `release` / `renderer` as synonyms. |

E.g. a new endpoint serving a Capacitor JS bundle goes at
`/api/capacitor/<thing>`, served by `examples/server-hono/server/routes/capacitor-<thing>.ts`,
called by `scripts/publish-capacitor-<thing>.sh`.

## License

By contributing, you agree that your contributions will be licensed
under the same [MIT License](./LICENSE) that covers the project.
