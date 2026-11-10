# /pick-issue — work one GitHub issue, end-to-end, in scope

Use this when the user asks you to "pick up an issue", "work through the backlog", or invokes `/pick-issue [<number>]`.

Optional argument: a specific issue number. If omitted, browse the open issues list and pick the smallest one you can confidently close in a single mechanical pass.

## Hard scope rule (read this first, every time)

**You are closing ONE issue. The diff must be the minimum that closes it.**

If you find yourself touching files unrelated to the issue, stop and split. Anything you notice while working that isn't the issue — a missing log call, a stale comment, a different bug, an outdated pattern — opens a **new** issue. It does not go into this PR.

This rule exists because every prior multi-purpose PR in gigmeister (where this workflow comes from) has either shipped a regression (silently stripped Zod fields, removed signed-URL generation, broke dotenv timing) or stalled in review for days. A 5-line PR ships; a 500-line "while I'm here" PR doesn't.

## Workflow

### 1. Read the issue and plan the minimum diff

```bash
# If a number was provided:
gh issue view <N> --json title,body,labels,comments
# Otherwise list and pick one labelled P2/P3 or `tech-debt`:
gh issue list --state open --label "P2,P3,tech-debt" --limit 20
```

Before touching any code, write down (in your own working notes, not a file):
- **What ships when this issue closes?** One sentence.
- **What files must change?** A specific list — usually 1-5 files.
- **What pattern does the change follow?** Point at an existing call site or the `docs/` page that describes it.

If you can't answer all three in 60 seconds, the issue isn't mechanical enough for this skill — escalate to `/create-plan` instead or ask the user.

### 2. Branch and implement

```bash
git fetch origin main
git checkout -b claude/issue-<N>-<slug> origin/main
```

Make the minimum change. Match the surrounding code exactly. No drive-by edits.

### 3. Run every CI gate locally — BEFORE pushing

This is the bar the PR will be measured against. If any of these fail, fix the cause before pushing — don't push and let CI tell you.

```bash
npm run lint               # --max-warnings 0, any warning fails
npm run typecheck          # strict tsc, web + electron/tsconfig.json
npm run test:run           # vitest in jsdom
npm run knip               # unused files/exports/deps
npm run build              # production web build
```

### 4. Self-review the diff against the issue scope

```bash
git diff origin/main...HEAD
```

For every hunk, answer one question: **does this hunk close the issue?** If the answer is anything other than "yes, directly", revert it. Common drift to revert:

- Renamed an import while editing → revert the rename
- "Fixed" an unrelated lint warning → revert
- Reformatted code Prettier didn't ask for → revert

### 5. Commit, push, open draft PR

Commit message focuses on **why**, references the issue:

```
fix: <short subject>

Closes #<N>. <One paragraph on why the change is correct.
Note any non-obvious decision (e.g. "kept env() inside the
handler so dotenv has loaded by then").>
```

```bash
git push -u origin claude/issue-<N>-<slug>
gh pr create --draft --title "<subject>" --body "$(cat <<'EOF'
## Summary
Closes #<N>.

<1-3 bullets on the change>

## Test plan
- [ ] CI: lint, typecheck, tests, build, knip
- [ ] <any manual check specific to this issue>
EOF
)"
```

Then `subscribe_pr_activity` so review comments land in your conversation.

### 6. Only after the PR is open, move to the next issue

Don't batch. Each issue is its own PR. The backlog is processed serially, not as a sweep.

## Vitronitor anti-patterns (do NOT do these mid-change)

- **Don't call the API with raw `fetch`** — use `apiFetch` from `@/lib/api-client`; it resolves the per-platform base URL (web, `capacitor://`, `app://`) and attaches the token.
- **Don't write straight to the API from a component** — mutations go through the offline-transactions outbox (`lib/sync/offline-executor.ts`), or they are lost offline.
- **Don't turn a permanent server error into a retryable one** — 404/410/422 must throw `NonRetriableError`, or the outbox loops forever.
- **Don't loosen a TanStack DB pin** in `package.json` or drop the `@tanstack/db` override. The family moves together (see CLAUDE.md → Dependencies).
- **Don't add app-specific features** — this is a boilerplate. If it doesn't generalise to every fork, it doesn't belong here.
- **Don't rewrite the `package-lock.json`** in a non-dependency PR. Regenerate only when `package.json` changed.

## When to escalate instead

Ask the user (`AskUserQuestion`) before opening the PR if any of these are true:
- The minimum diff turns out to touch more than ~5 files
- The fix requires a database migration (`supabase/migrations/`)
- The fix changes the sync protocol, the outbox, OTA signing/verification, or a contract in `docs/BACKEND_CONTRACTS.md`
- You found a separate bug while working — confirm whether to open a follow-up issue or batch it
- The issue is labelled `security` (follow SECURITY.md, not a public PR)

## Done state

The PR is open as a draft, CI is green, and the issue body links the PR. You can then ask the user whether to mark the PR ready for review, or move on to the next issue.
