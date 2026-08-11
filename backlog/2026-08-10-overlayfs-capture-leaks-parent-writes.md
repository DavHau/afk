# overlayfs isolation leaks parent and sibling writes into every isolated-task capture

Filed: 2026-08-10
Area: `nix/afk.nix:60` (`task.isolation.mode`), `crates/pi-iso/src/linux_reflink.rs`; omp 17.2.12
Severity: **Critical** — a parked ref contains work the agent never did, including the
owner-protected `GOAL.md` and files authored by concurrent subagents. Adopting such a ref
silently reverts the parent's own work. Near-miss on 2026-08-10: a capture would have
deleted a test suite's `mmm-5o8` guards and restored a float pin the fix had corrected,
caught only because a pinned value moved by 3 ulp.

omp source: `nix eval --raw /home/grmpf/synced/projects/afk#packages.x86_64-linux.omp-patched.src`
(`src/task/vcs.ts` is created by `patches/omp/omp-vcs-handle-seam.patch`, not upstream.)

**RESOLVED 2026-08-11.** Implemented exactly as proposed, with the split the
build architecture forces (Rust patches must live in the natives derivation):

1. `nix/afk.nix`: `mode: overlayfs` → `mode: reflink`. The user's global
   `~/.omp/agent/config.yml` ALSO pinned `mode: overlayfs`, which layers above
   the distro config and would have silently overridden the switch — the mode
   key was removed from that layer in the same pass (see the sibling backlog
   item's `autoApply` cleanup).
2. `patches/omp/omp-reflink-degraded-copy.patch` (Rust, applied by
   `nix/omp-natives.nix`): `clone_file` falls through to `std::io::copy` on
   `EXDEV|EOPNOTSUPP|ENOTTY|EINVAL|ENOSYS` — permissions/mtimes preserved via
   the existing post-clone path. Verified by `cargo test -p pi-iso` (6/6):
   tree materialisation + frozen-snapshot assertion (parent writes after
   start are invisible), and a `/dev/shm` (tmpfs) test that exercises the
   real EOPNOTSUPP byte-copy path.
3. `patches/omp/omp-isolation-require-cow.patch` (TS):
   `task.isolation.requireCow` (boolean, default false, host-defaulted)
   plumbed settings → structured-subagent → isolation-runner →
   `ensureIsolation` → `isoStart`'s new `options` napi parameter; `true`
   makes the reflink backend return `ISO_UNAVAILABLE` instead of degrading,
   which under the pinned backend fails the spawn loudly.
4. "Worth doing alongside" (emit authored paths with the capture):
   deliberately NOT implemented — under `merge: branch` the parked ref
   carries the authoritative file list (`git show --stat <ref>`), and the
   new branch-downgrade notification
   (`omp-isolation-branch-capture-note.patch`) names the patch artifact,
   whose `diff --git` headers are the file list.

Capture-side confirmation (17.2.12 source): `captureRepoDeltaPatch` reads all
live state from the isolation dir only and uses the parent repo purely as an
object store through a temp `GIT_INDEX_FILE` — with a frozen reflink tree the
contamination class is gone by construction, for both `branch` and `patch`
captures.

## The problem

`captureRepoDeltaPatch` (`packages/coding-agent/src/task/worktree.ts:162-192`) computes the
agent's delta as:

```
baselineTree = rb.headCommit + parent's staged+unstaged+untracked  AT DISPATCH
currentTree  = rb.headCommit + agent's  staged+unstaged+untracked  AT CAPTURE
patch        = git diff-tree baselineTree currentTree
```

`currentTree` is read out of the **merged view**. Under `overlayfs` that view is not a
snapshot — its lower layer is the parent's live working tree, so any file the agent never
wrote reads through to whatever the parent holds *now*.

A parent write landing after dispatch is therefore in `currentTree`, absent from
`baselineTree`, and attributed to the agent. Contamination is proportional to how much the
parent writes during the run.

## Evidence

Five captures from 2026-08-10, pinned in `mmm` so they survive `git gc`:

```
git -C ~/synced/projects/mmm for-each-ref refs/evidence
```

| capture | baseline | files | unexplained | leaked from |
|---|---|---|---|---|
| `CyclicSlot` | `2c78cf06` | 3 | **0** | — no parent commit during its run |
| `StoreSidecar` | `2c78cf06` | 7 | **0** | — same |
| `FleetStatus` | `3cf084b2` | 5 | **2** | `mmm/__main__.py`, `mmm/models/checkpoint.py` — parent commit `b2f00b9` landed mid-run |
| `NoiseFloor` | `3b8bef97` | 4 | **2** | `AGENTS.md`, `GOAL.md` — parent commits `2c78cf0`, `3cf084b` landed mid-run |
| `AlignmentArms` | `3b8bef97` | 47 | **~44** | a full afternoon of parent commits, plus `scripts/fleet_status.py` and `tests/test_fleet_status.py` written by the concurrent `FleetStatus` agent |

Every unexplained file is a parent write that landed after that capture's baseline:

```
git -C ~/synced/projects/mmm log --oneline 3cf084b2..HEAD -- mmm/__main__.py mmm/models/checkpoint.py
git -C ~/synced/projects/mmm log --oneline 3b8bef97..HEAD -- AGENTS.md GOAL.md
```

Leaked content is byte-identical to the parent's content at capture time, which is why it
survives inspection. Present in `patch` mode too: `TrainProfile`'s patch carries two files
authored by `AlignmentProtocol` running concurrently. `.beads/issues.jsonl` appears in
**16 of 16** captures in this project (22 of 119 host-wide); subagents never write beads.

## Fix

### 1. `nix/afk.nix:60`: `mode: overlayfs` → `mode: reflink`

`reflink` materialises a real frozen tree, so nothing can read through to the parent. This
removes the contamination class by construction rather than mitigating it.

| | |
|---|---|
| parent **edits** a file mid-run → leaks? | **No** |
| parent **creates** a file mid-run → leaks? | **No** |
| gitignored files present (`rcopy` drops these) | **Yes** — `.beads/embeddeddolt/` et al |
| `data` → `~/bigfiles/mmm` symlink | preserved as a symlink |

### 2. Make `reflink` degrade to a byte copy when the filesystem has no `FICLONE`

Required, not optional: without it this change makes afk unusable on ext4. `probe()`
(`linux_reflink.rs:30-39`) reports available on **any** Linux — it never tests the
filesystem — so the failure surfaces mid-tree at the first regular file, where
`clone_file` maps `EXDEV|EOPNOTSUPP|ENOTTY|EINVAL|ENOSYS` to `IsoError::unavailable`
(`linux_reflink.rs:203-241`). With an explicit mode pinned there is no fallback, so **every
isolated spawn fails**.

The seam is `clone_file`: both fds are already open, so on those errnos fall through to
`std::io::copy` instead of returning. Measured on this repo (1.3 GB apparent, 4645 files):

| | CoW (`amy`/`som`, ZFS) | byte copy (`vit`, ext4) |
|---|---|---|
| clone wall | 0.27 s | **1.78 s** |
| teardown | 0.12 s | 0.10 s |
| on-disk cost | 2.5 MB | **445 MB** |

1.78 s per spawn is an acceptable default; 445 MB per concurrent subagent is the real
ceiling to keep in mind (`runs/` is 793 MB of the 1.3 GB apparent size).

**This is not the fallback the pin forbids.** `patches/omp/omp-isolation-pinned-backend.patch`
exists because degrading to `rcopy` silently changes *which files the snapshot contains* —
it drops gitignored files. Degrading within the reflink backend changes only *how bytes are
stored*; the file set, the freeze and the capture are identical. The current binary
(`pin` = refuse, `auto` = silent chain) conflates those two, and only the first deserves
loudness.

### 3. A knob to refuse the degradation per host

For hosts where a 6.6x wall and 178x disk increase should be an error rather than a
shrug — and to catch a filesystem regression, e.g. amy losing block cloning — add a
strictness flag (`task.isolation.requireCow: true`) that restores the hard failure. Default
off, so the tool stays generic. Per-host without touching nix: `~/.omp/config.yml`
overrides the distro layer at runtime.

### Worth doing alongside

Emit the list of paths the agent authored with the capture. The harness knows it and
discards it; without it an integrator facing a bad capture reconstructs authorship by hand.

## Acceptance criteria

1. A probe subagent whose parent edits and creates files during the run parks a ref
   containing only the probe's own writes. Fails today.
2. Two concurrent probe subagents park refs that do not contain each other's files.
   Fails today.
3. No capture contains `.beads/issues.jsonl` unless the agent was asked to touch beads.
   Cheapest canary; currently 16/16 positive.
4. An isolated task spawns and captures correctly on a filesystem without `FICLONE`
   (ext4). Fails today with `mode: reflink`; this is the portability regression test.

## Before shipping

- The measurements above used `cp --reflink=always` / `--reflink=never`. omp's backend
  recreates trees itself; confirm it matches, including the degradation path.
- No end-to-end run under `mode: reflink` yet — needs the config change, an omp rebuild and
  a harness restart.
- omp is currently installed on **`amy` only** (checked; not on `som` or `vit`), so nothing
  breaks today. `amy` and `som` are ZFS with `FICLONE`; `vit` is ext4 without it, which is
  what makes item 2 a prerequisite for ever running the harness there.

## Related

`2026-08-10-isolation-branch-merge-falls-back-to-patch.md` — resolved by the 17.2.12 bump.
The contamination here affects both `branch` and `patch` captures, so it is independent.
