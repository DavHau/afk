---
name: merging-parked-task-refs
description: Use when adopting or discarding work parked by isolated task subagents on refs/omp/task/* - the cherry-pick recipe, the jj-colocated ordering law that prevents orphaned anonymous heads, and the post-batch sweep
---

# Merging parked task refs

Each finished isolated subagent parks its commits on `refs/omp/task/<id>` and
touches nothing else. You integrate every ref by hand.

The refs sit outside `refs/heads/*` so jj's import ignores them (deleting one
can never make jj abandon commits). Price: **jj cannot resolve them** — use
git plumbing only, and never point jj at a ref, since every jj call also
snapshots the working copy.

```
git for-each-ref refs/omp/task                 # pending work; empty = nothing owed
git diff $(git merge-base HEAD <ref>)..<ref>   # review; worktree untouched
git cherry-pick $(git merge-base HEAD <ref>)..<ref>
git update-ref -d <ref>                        # after adoption OR rejection
```

Then review and test. Rejecting is just the delete, no adoption step.

- **"empty cherry-pick"**: already an ancestor of HEAD → `--skip`, never
  `--allow-empty`.
- **Conflict**: `--continue`, or `--abort` and lift files via
  `git show <ref>:<path>`.
- **Broken index**: `rm -f .git/index && git read-tree HEAD` — derived state,
  jj and the worktree are untouched.
- **Provenance not needed?** `git diff <range> | git apply -3` lands the same
  content without moving HEAD, which voids the ordering law below. Costs you
  the individual commits and the cherry-pick sequencer.

## Ordering law — jj-colocated repos only

`git cherry-pick` moves HEAD behind jj's back; the next jj command re-parents a
fresh working copy onto it and the old `@` survives as a stale anonymous head
whenever it was described or non-empty. Hence accumulated orphans (25 in one
verified case), and descriptions written just before a pick landing on the
orphan instead of `@`.

- Enter every batch with `@` **empty AND undescribed**: `jj describe -m "…"` to
  close out prior work, then a plain `jj new` (no `-m`).
- NEVER `jj describe` / `jj new -m` immediately before a pick.
- Describe `@` only AFTER the batch — and again after each later batch.
- Sweep: `jj log -r 'heads(mutable()) ~ ::@ ~ bookmarks() ~ working_copies()'`
  MUST be empty. `~ working_copies()` is load-bearing: every OTHER jj
  workspace's working-copy commit is a mutable head too, and `jj abandon`
  merely recreates it (the sweep would loop forever).
  `jj abandon` a listed head only once you confirm its content is already in
  `@`'s ancestry; otherwise LEAVE IT — more likely the user's live work than
  garbage. `jj op restore` recovers mistakes.

Plain-git repos: recipe unchanged, ordering law and sweep do not apply.
