---
alwaysApply: true
---

# Version control: jj (Jujutsu), colocated

This distribution mandates **jj**, colocated with git. Use jj for all local
version control; remotes and pushes are plain git under the hood.

- If the project has no `.jj` directory, initialize it with
  `jj git init --colocate` before making changes.
- Inspect state with `jj st` (working-copy changes) and `jj log -r @` (the
  current change). `@` is the working-copy commit; it is always a real commit,
  not a staging area.
- Workflow is **describe-then-new**, not stage-then-commit: make edits, then
  `jj describe -m "<summary>"` to record the message on `@`. Start the next
  logical change with `jj new`. Never commingle unrelated work into one
  described change.
- To amend an older change: `jj new <target>`, make the fix, then `jj squash`
  to fold it into the parent.
- Publish a bookmark with `jj git push --bookmark <name>` (set it first via
  `jj bookmark set <name> -r @`).
- The jj **op log** (`jj op log`) records every operation and is the substrate
  for recovery — `jj op restore <id>` undoes a bad operation.

**Isolated subagents run no version control.** Harness-isolated `task`
subagents work in a copy-on-write snapshot; the harness captures their changes
automatically, so they must never run `jj` or `git` against the repo.
