---
name: bumping-superpowers
description: Use when bumping the pinned Superpowers input of this repo (flake input `superpowers`) and rebasing the patches under patches/superpowers/
---

# Bumping Superpowers

## The instructions (from the maintainer, verbatim in spirit)

> Bump superpowers to the latest version. Rebase all our patches, or drop
> them in case some are not necessary anymore. Make sure you understand the
> purpose of all patches first, in full, before doing anything. Make sure
> the motivation behind the patches stays after rebasing as a comment and
> doesn't get lost.

## Layout

- `flake.nix` input `superpowers` (non-flake, `ref=main`); `nix/afk-skills.nix`
  builds `src + patches/superpowers/*.patch` with `patch -p1`.
- Every patch starts with a free-text preamble: what it does, **Motivation**,
  and **What must survive a rebase**. The preamble is the comment that must
  not get lost; `patch` ignores everything before the first `diff --git`.
- Patches touch disjoint files, so one `git diff -- <files>` regenerates each.

## Process

1. **Understand first.** Read every patch in full — preamble and hunks —
   before touching anything. Know which upstream behavior each one guards
   against (isolated subagents + parked refs, jj colocation, no model
   parameter / agent types, todo reminders, …).
2. **See what upstream changed.** In a checkout under `~/projects/superpowers`:
   `git fetch`, then `git log --oneline <pinned-rev>..origin/main` and
   `git diff <pinned-rev> origin/main -- skills/`. Pinned rev:
   `jq -r .nodes.superpowers.locked.rev flake.lock`.
3. **Dry-run the old patches** in a scratch worktree of `origin/main`
   (`git worktree add --detach /tmp/sp-new origin/main`), one
   `patch -p1 --dry-run` per patch, to see what conflicts.
4. **Rebase per patch**, against the new upstream text, not by forcing old
   hunks in:
   - Re-apply the *intent* in the preamble, including to new upstream
     content that reintroduces what a patch removes (worktrees, "specify the
     model", `general-purpose` subagents, git commit steps, …).
   - Keep upstream's new material unless it contradicts a patch's intent.
   - **Drop** a hunk or a whole patch when upstream deleted the file or now
     does the same thing itself — and say so in the preamble.
5. **Regenerate** each patch as `<preamble>` + `git diff -- <its files>`
   (use `git add -N` for new files). Update each preamble: keep the original
   motivation, add what this rebase changed and why (name the upstream
   release).
6. **Bump and verify**:
   - `nix flake update superpowers`
   - every patch applies to a clean checkout with `patch -p1 -F0` (no fuzz)
   - `nix build .#afk-skills .#afk`
   - `bun test`
   - smoke-run any patched script (`scripts/task-brief`,
     `scripts/review-package`, …) in a throwaway git repo
7. Remove scratch worktrees (`git worktree remove`), then `jj describe` with a
   per-patch summary: rebased, reworked, or dropped, and why.
