# Isolated-task capture silently falls back to patch mode; `refs/omp/task/*` is never created

Filed: 2026-08-10
Area: `nix/afk.nix` (distro `task.isolation`), `patches/omp/omp-jj-colocated-task-refs.patch`,
`patches/omp/omp-isolation-pinned-backend.patch`; omp/17.2.1
Severity: Important — the configured capture mode is not the one in use, and the
documented check for unadopted work reads clean while work accumulates unseen.

**RESOLVED 2026-08-10 by the omp 17.2.12 bump.** Branch capture now produces refs: 16
`.patch` captures earlier that session, then 5 `refs/omp/task/*` refs after the bump.

The 97 historical `.patch` captures named below still want triaging, but on the terms of
`2026-08-10-overlayfs-capture-leaks-parent-writes.md`: captures in both modes carry parent
and sibling writes.

**CLOSED OUT 2026-08-11** against 17.2.12 source (the 17.2.1 tree is no longer
pinned locally, so the original failure is not reproduced line-by-line; the
17.2.12 mechanics below bound what it could have been):

1. **Root cause class (AC1).** `merge: branch` is honored deterministically
   (`isolation-runner.ts:176` → `commitToBranch`/`commitToTaskRef`), but ANY
   throw inside the branch commit converts the run into a `.patch` capture:
   `isolation-runner.ts:189-215` deletes the stale ref, writes
   `<id>.patch`, and sets `result.error = "Merge failed: <msg>"`. There is no
   strategy check and no opt-out — hypothesis 2 (branch capture attempted,
   failed, fell back) was the mechanism; the `merge` key was never dead
   (hypothesis 1 wrong for 17.2.12). The 97-for-97 consistency matches the
   parent worktree carrying uncommitted changes essentially all session
   (the `Entry not uptodate` class). The 17.2.12 bump fixed the underlying
   commit failure; refs have been produced ever since.
2. **Why it was silent (the real defect).** Under `apply: false`,
   `structured-subagent.ts` renders the downgrade as
   `Isolation: changes captured at \`<id>.patch\` (apply=false). Not
   applied.` — byte-identical to a configured patch-mode run; `result.error`
   is never rendered into the summary, and the merge phase (whose "Branch
   merge failed" notification would fire) is skipped because of that same
   error. Fixed by `patches/omp/omp-isolation-branch-capture-note.patch`:
   a branch-mode capture that produced a patch artifact now renders a
   `<system-notification>` naming the FAILED branch capture with
   `result.error` and the artifact path; error-with-no-artifact gets its own
   loud "changes were lost" notification.
   Since omp 18.2.10 upstream covers this itself: a successful run with
   `result.error` renders a `capture-error` `<system-notification>` (error
   text plus patch path) ahead of the apply=false summary, so the patch was
   dropped.
3. **AC4, amended.** "Fails the spawn loudly" is wrong at capture time — the
   subagent's work already exists, and destroying it would be worse than the
   downgrade. The invariant shipped instead: the downgrade can no longer be
   mistaken for a configured patch capture. (Known residual soft spots,
   upstream-scoped: `isolation-runner.ts:175` deferred-cleanup returns with
   no artifact at all, and an empty `commitToBranch` result is
   indistinguishable from "no changes".)
4. **Stale `autoApply` (AC3).** `~/.omp/agent/config.yml` turned out to be an
   orphaned Nix-store symlink from the removed pi.nix wrapper (hyperconfig no
   longer generates it; afk under `OMP_PROFILE=afk` never reads it). It also
   still pinned `mode: overlayfs`, which layers ABOVE the distro config and
   would have silently defeated the reflink switch had the file ever applied.
   Replaced with a user-owned file carrying only the safety keys
   (`apply: false`, `merge: branch`, no `mode`); original preserved at
   `config.yml.pre-2026-08-11.bak`.
5. **AC5.** Not needed: patch capture is now loud, refs remain authoritative,
   and the ref-based guidance stands unchanged.
6. **The historical captures (AC6).** 119 by close-out (82 mmm, 26 ntop, 4
   /tmp/yolo, 5 VibePN, 2 /tmp/game, ~6.9 MB). Decision (2026-08-11, with
   the human partner): archived to
   `~/.omp/profiles/afk/capture-archive-2026-08-11.tar.gz` (119 members
   verified) and removed from the sessions tree — the bytes survive, but no
   future session can mistake a contaminated capture for recoverable work.
   The five forensically pinned captures remain in mmm's `refs/evidence`.

## Incident

`task.isolation.merge: branch` is set in both config layers, yet no isolated subagent
has ever produced a task ref. Every capture lands as a `.patch` file instead.

Configured (both layers agree):

```
nix/afk.nix:60-62              ~/.omp/agent/config.yml:46-48
  mode: overlayfs                mode: overlayfs
  merge: branch                  merge: branch
  apply: false                   autoApply: false   <- stale key, see below
```

Observed, across every project on this host:

| evidence | value |
|---|---|
| `.patch` captures under `~/.omp/profiles/afk/agent/sessions/` | **97** |
| `git for-each-ref refs/omp/task` in `mmm` / `afk` / `hyperconfig` / `mm` | **0** in all four |
| task-result status on every isolated subagent | `status="merge failed"` |
| span | 2026-08-08 through 2026-08-10, 8 session dirs in `mmm` alone |

Every result carries the same summary line:

```
Isolation: changes captured at
  /home/grmpf/.omp/profiles/afk/agent/sessions/-synced-projects-mmm/<session>/<Name>.patch
  (apply=false). Not applied.
```

All four repos are colocated jj with detached git HEAD (`git worktree list` ->
`<sha> (detached HEAD)`), which is the configuration
`omp-jj-colocated-task-refs.patch` exists to serve. Both that patch and
`omp-isolation-pinned-backend.patch` are in the build list
(`nix/omp-patched.nix:92` and `:101`).

**Overlayfs itself is fine — do not start there.** Verified 2026-08-10 with a probe
subagent in `mmm`:

```
overlay on /home/grmpf/.omp/profiles/afk/wt/t540db4557/m type overlay
  lowerdir=/home/grmpf/synced/projects/mmm
  upperdir=/home/grmpf/.omp/profiles/afk/wt/t540db4557/upper
  workdir=/home/grmpf/.omp/profiles/afk/wt/t540db4557/work
```

The upper layer held exactly one entry (the single file the probe edited), the parent
worktree was byte-identical during and after the run, the emitted patch applied and
reverted cleanly, and the overlay dirs were cleaned up on exit. The lower layer is the
parent's live working copy, not HEAD — the probe could read an uncommitted file. Only
the *capture mode* is wrong.

### Why it matters

1. **Patch mode is the one we rejected, for reasons that still hold.** Our own config
   comment says `branch` is "more robust than `patch` for staged-new and binary files,
   and overlaps surface as real merge conflicts instead of silently dropped hunks."
   Captures in this project have reached 41 KB and 62 KB across 9 files; a silently
   dropped hunk there is not hypothetical.

2. **The documented safety net is a no-op.** The global AGENTS.md (generated by
   `hyperconfig/modules/nixos/omp-common.nix:156-173`) instructs every top-level agent
   that `git for-each-ref refs/omp/task` is "the authoritative list of pending work…
   non-empty output = unmerged work", to be run at session start and before the final
   `jj describe`. That command now always returns empty. An agent following the
   instruction correctly concludes "nothing parked" while 97 patch files sit
   unadopted. The always-applied rule `profile/rules/isolated-task-merge.md` and
   `skill://merging-parked-task-refs` rest on the same assumption.

3. **A pinned setting degraded silently — the exact failure `omp-isolation-pinned-backend`
   was written to prevent.** That patch makes an explicit `mode` fail loudly rather
   than fall back. `merge` has no equivalent guard, so the asymmetry is: pin the
   backend and a bad host fails loudly; pin the merge strategy and it quietly does
   something else.

4. **`status="merge failed"` is misleading under `apply: false`.** With apply off,
   nothing should be merged at all, so a "failed merge" is either a real failed
   attempt that then fell back, or a mislabelled non-event. The label currently
   trains readers to ignore it, which is how this went unnoticed for three days.

## Suspicions (unverified — source not read)

Listed as hypotheses only; whoever picks this up should confirm against omp 17.2.1
source rather than trusting the ordering here.

1. **The `merge` key was renamed or dropped upstream, like `autoApply` before it.**
   `nix/omp-patched.nix:13-15` records that `omp-isolation-auto-apply` was dropped at
   17.1.3 because upstream shipped `task.isolation.apply` with identical semantics. If
   `merge` received similar treatment across 17.1.x–17.2.1, both layers would now be
   setting a dead key and the runtime would use its own default. This is my leading
   suspicion because it explains the *silence*: a dead key produces no error, and
   `omp-isolation-pinned-backend` guards `mode` only.

2. **Branch capture is attempted and fails, then falls back.** This is what
   `status="merge failed"` reads like on its face. Note the "Related loud failure"
   section of `patches/omp/omp-jj-colocated-task-refs.issue.md`: `error: Entry '<file>'
   not uptodate. Cannot merge.` when the parent working copy changed during the run.
   That precondition held for most of these runs — the parent had uncommitted changes
   nearly the whole session. Against this hypothesis: the fallback is 97 for 97, and a
   race would be intermittent.

3. **The `apply: false` path never reaches branch capture in 17.2.1.** Isolation
   orchestration moved into `task/structured-subagent.ts` at 17.0.4 per
   `nix/omp-patched.nix:2-5`; if capture-mode selection sits behind the apply branch,
   turning apply off could skip ref creation entirely and take a patch-only path.

## Secondary finding: stale `autoApply` in the user's global config

`~/.omp/agent/config.yml:48` still sets `autoApply: false`. That key has been inert
since 17.1.3 (`nix/omp-patched.nix:13-15`); the live key is `apply`. It is currently
harmless *only* because `nix/afk.nix:62` sets `apply: false` in the distro layer
underneath. The footgun: the file reads as though the user's own config controls
auto-merge, so a host without the afk distro layer — or any future edit that trusts
the global file alone — would silently get upstream's `apply: true` and have isolated
changes auto-merged into a live worktree, which is precisely what
`omp-isolation-auto-apply` was introduced to prevent.

Confirmed not to originate from hyperconfig: `modules/nixos/omp-common.nix:6-10`
records that the generated `config.yml` no longer lives there ("keeps config.yml
user-owned with distribution defaults layered underneath via `$OMP_DISTRO_CONFIG`"),
and `git grep autoApply` over hyperconfig's tracked files returns nothing.

## Acceptance criteria

1. The root cause is identified against omp 17.2.1 source and recorded here, replacing
   the hypotheses above.
2. Isolated-task captures land on `refs/omp/task/<id>` again, demonstrated by a probe
   subagent in a colocated jj repo: the ref exists, `git for-each-ref refs/omp/task` is
   non-empty, and the parent worktree is untouched until it is cherry-picked.
3. If the cause is a renamed/removed key, both `nix/afk.nix` and the user's global
   `config.yml` are updated, and the stale `autoApply` is removed in the same pass.
4. A pinned `merge` strategy that cannot be honoured fails the spawn loudly, in the
   idiom of `omp-isolation-pinned-backend`. Silent fallback to a different capture
   mode is the defect, independent of which mode is correct.
5. If patch capture is ever a legitimate outcome, the guidance that depends on refs is
   corrected in the same change: the global AGENTS.md text in
   `hyperconfig/modules/nixos/omp-common.nix:156-173`, `profile/rules/isolated-task-merge.md`,
   and `skill://merging-parked-task-refs` all currently tell agents to trust
   `git for-each-ref refs/omp/task` as authoritative.
6. The 97 existing `.patch` captures are triaged or deliberately discarded — they are
   the accumulated evidence of the gap, and at least some represent work that was
   reviewed and adopted by hand while others may never have been looked at.
