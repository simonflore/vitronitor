---
name: codex-review
description: Work a Codex (or other automated) review on a pull request — classify each finding, fix the class rather than the instance, prove the fix with a test that fails without it, and recognise when the review loop has stopped paying. Use when Codex posts findings, when review comments arrive on a PR, when deciding whether to keep taking review rounds, or when a fix keeps opening the next gap.
user-invocable: true
---

# Working a Codex review

Codex reviews PRs here and the signal is good. The failure mode is rarely *missing* a finding; it is **how you fix it**. A run of twelve rounds on one gigmeister PR produced twenty-one findings, and from round five onward nearly every one was an edge opened by the previous fix rather than something wrong with the original design.

[CLAUDE.md](../../../CLAUDE.md#working-with-automated-code-review-codex) sets the calibration: fix real bugs, note the theoretical, escalate rather than grind. This skill covers the mechanics of avoiding a run like that.

## 1. Verify the claim before you write anything

Open the file it points at and confirm **both** the mechanism and that the suggested fix is reachable. A reviewer can name a field on the wrong type, or describe a fallback that does not exist.

Cheap and worth it every time:

```bash
# The finding says the outbox retries a 422 forever.
grep -n "NonRetriableError\|422" lib/sync/offline-executor.ts
```

Two findings in that run were only actionable because the claim checked out in source. State the confirmation in your reply — `offline-executor.ts:67` beats "good catch".

## 2. Classify it before you fix it

| Kind | Tell | Do |
|---|---|---|
| **Real defect in the original design** | Predates your work on this PR | Fix it. This is what the review is for. |
| **Self-inflicted** | Introduced by a commit earlier in *this* PR | Fix it, and **count it** — see §4. |
| **Instance of a class** | Third-ish finding sharing one shape | Stop. Fix the class — see §3. |
| **Valid but out of scope** | Fix lives in another subsystem, needs a native/shell release, or cannot be verified | Escalate — see §6. |
| **Theoretical** | Edge that cannot occur in this setup | One-line reply, resolve, move on. |

## 3. Fixing the class, not the instance

Three findings sharing a shape means more exist that have not been found yet, so patching them one at a time never catches up.

1. **Name the invariant in one sentence.** For that gigmeister PR: *three actions share one socket, each awaits, and the form beneath them stays editable — so a late result must be able to tell that it is stale.*
2. **Find every site the invariant covers**, not only the ones reported.
3. **Build one mechanism** and route every site through it. That PR ended with `beginSocketOp()` returning `stale()` and `release()`, claimed synchronously in a ref because the decisive window is before any re-render.
4. **Say so in the reply.** "Structurally rather than by adding the same check twice more" tells the reviewer to check the mechanism, not the instance.

## 4. Know when the loop has stopped paying

Keep a running tally per PR: how many of the last three rounds were caused by **your own previous fix**?

- **0–1** — the review is finding real things. Keep going.
- **2+** — you are generating the findings. Stop patching. Either do the structural fix (§3) or stop and put it to the maintainer.

"It's only one line" is not a reason to keep going: that argument is available every round, and it is what sustains the loop. When you stop, say plainly: rounds taken, findings, how many were self-inflicted, what the remaining class is, what ending it properly would cost, and your recommendation. Then **hold**, and do not take the next round on your own initiative.

Costs are real: review credits, CI minutes, and the maintainer's attention. On a flag-gated feature nobody has asked for yet, a tenth round is rarely worth it.

## 5. Two opposite ways to get a fix wrong

Both happened in one PR, two rounds apart.

**Under-applying — the missed sibling.** Cleared the cached bus label on a console change, left the channel names beside it. Same state, same lifetime, one site updated.

> Before pushing: grep for every other place that touches the state you just guarded or cleared. If two things are invalidated by the same event, they belong in one helper.

**Over-applying — breaking the common case.** Then cleared those labels on *every* path that sets the host, including setting it to the value it already had. A routine rescan re-finds the configured address (it is probed first, precisely because it is the likely answer) and threw the labels away.

> Before pushing: ask what the *ordinary* use of this path looks like, and write the test for that, not the exceptional one.

## 6. Escalating is never silent

When a finding is valid but the fix belongs elsewhere — another subsystem, a shell release, something unverifiable without hardware — do all four:

1. **Reply** saying it is valid, why it is not fixed here, and what the fix would involve.
2. **Record it** in the relevant `docs/` page as a known limitation.
3. **Ship a mitigation if one is cheap.** Usually diagnostic: make the failure legible. A fruitless subnet sweep that names the range it covered turns `No console answered on 172.17.0.x` into a diagnosis instead of a broken feature.
4. **Leave the thread open.** Resolving it claims work you did not do.

## 7. Prove the fix

A test written after the fix proves nothing. Prove it the other way:

```bash
# 1. Write the test. Run it. It must fail.
npx vitest run path/to/test.ts -t "the case"

# 2. If it passes, you have not reproduced the bug — fix the test, not the code.

# 3. After fixing, prove the test is real by neutralising the fix:
cp src/thing.ts /tmp/keep.ts
python3 -c "...remove the guard line..."
npx vitest run path/to/test.ts -t "the case"   # must fail
cp /tmp/keep.ts src/thing.ts                    # restore
```

That round trip caught a test that passed for the wrong reason, and one whose setup never reached the code under test.

**Red is not automatically the right red.** Check *which* assertion failed and
that it failed for the reason you predicted. A draft of the `mixName` test used
the address field as its second action — but changing the address drops the
cached label deliberately, so the test stepped around the bug and went red on a
later line for an unrelated reason. Dump what the code did before believing a
failure:

```bash
# Force the real value into the failure output rather than guessing at it.
expect(saveMixerConfig.mock.calls.map((c) => c[0])).toBe('SHOW ME');
```

Changing it to a field with no such side effect (channel count) made it fail
where it should: no save at all.

**Read the pass count, not the exit status.** This shipped a red commit:

```bash
# WRONG — grep matches the word "FAIL", so && continues and the push succeeds
npx vitest run 2>&1 | grep -E "Tests |FAIL" && git commit … && git push

# RIGHT — look at the number, then commit as a separate step
npx vitest run 2>&1 | grep -E "^ +Tests"
```

## 8. Replying and resolving

One reply per thread, then resolve — except escalations (§6), which stay open.

A good reply states: confirmed or disputed, the commit SHA, what the mechanism was, and that the test was confirmed failing against the previous SHA. Where you took one of two suggested options, say which and why. Where the finding caught **your own** regression, say so — it is the most useful thing in the thread for whoever reads it next.

Every comment ends with the attribution footer:

```

---
_Generated by [Claude Code](https://claude.ai/code)_
```

## Hard rules

- **Never resolve a thread you did not fix.** Escalations stay open and visible.
- **Never push without reading the pass count.** Not the exit status, not a grep that matches "FAIL".
- **Never take a review round past a 2-in-3 self-inflicted ratio** without putting it to the maintainer first.
- **Never widen the PR** to fix something in another subsystem. Escalate (§6).
- **A finding introduced by your own previous fix is a signal, not only a bug.** Count it.
- **Keep the PR description true.** After several rounds it will be stale — withdrawn claims and superseded test counts are worse than no description.
