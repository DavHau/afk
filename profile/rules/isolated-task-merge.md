---
alwaysApply: true
---

# Merging isolated subagent changes

Isolated `task` subagents never write to your worktree. When one finishes,
its changes are parked as commits on a hidden git ref `refs/omp/task/<id>`
(the task result names the ref). Nothing merges automatically and nothing
will remind you later — you, the top-level agent, integrate each ref.

- `git for-each-ref refs/omp/task` — the authoritative list of pending
  work. Run it at session start and before finishing any task; non-empty
  output = unmerged work. Adopt or discard deliberately.
- Review before merge (preferred): a parked ref's diff is
  `git diff $(git merge-base HEAD <ref>)..<ref>` — inspectable without
  touching the worktree. Reject bad work by deleting the ref unmerged.
- Merge: clean worktree first (`jj describe`, then `jj new` if `@` is
  non-empty), then `git cherry-pick $(git merge-base HEAD <ref>)..<ref>`,
  review, test.
- Delete the ref after adoption or rejection: `git update-ref -d <ref>`.
- On conflict: resolve and `git cherry-pick --continue`, or `--abort` and
  extract files via `git show <ref>:<path>`. If the index ends up broken:
  `rm -f .git/index && git read-tree HEAD` (the index is derived state; jj
  and the worktree are untouched).
- Inspect parked refs with read-only git plumbing only (`git show`,
  `git diff`, `git log`) — never jj: these refs are invisible to jj, and jj
  commands snapshot the working copy as a side effect.
