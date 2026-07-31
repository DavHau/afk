---
alwaysApply: true
---

# Parked work from isolated subagents

Isolated `task` subagents never write to your worktree. Each finished agent
parks its changes on a hidden git ref `refs/omp/task/<id>`. Nothing merges
automatically and nothing will remind you later — the top-level agent owns
every parked ref.

- `git for-each-ref refs/omp/task` — the authoritative list of pending work.
  Run it at session start and again before finishing any task. Non-empty
  output means unmerged work: adopt or discard it deliberately, never leave it.
- Before adopting or discarding, read `skill://merging-parked-task-refs` — the
  recipe, the jj ordering law it depends on, and the post-batch sweep.
