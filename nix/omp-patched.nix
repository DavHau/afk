# omp-patched: omp from llm-agents + the jj-relevant patch set. Originally
# vendored from hyperconfig, rebased onto omp 17.0.0, then 17.0.4 (isolation
# orchestration moved into task/structured-subagent.ts), then 17.2.1 (eval
# isolation tests moved to test/eval/agent-bridge-policy.test.ts; the
# auto-thinking ceiling became upstream's autoEffortCeiling()), then 17.2.12
# (isolation orchestration split into task/isolation-runner.ts; upstream added
# deferred-cleanup tracking and streamed tool-call id re-keying), then 17.2.14
# (two personal patches rebased back in: the Anthropic weekly-reset ranking
# and the status-line account email), then 18.0.11 (upstream moved ALL VCS
# operations in-process behind @oh-my-pi/pi-natives/vcs — gitoxide/jj-lib —
# deleting the TS utils/git.ts/utils/jj.ts façades; the whole jj patch family
# was re-cut against the native layer, raw refs/omp/* plumbing now shells to
# `git update-ref` since the natives hardcode refs/heads/), then 18.1.4
# (event-controller's toolCall loop resolves toolRenderName(content.name)
# right after the id re-key; the streamed-tool-name-rebind displacement hunk
# re-anchored above that resolution), then 18.1.13 (upstream split
# task.isolation.mode into task.isolation.enabled + isolation.backend —
# afk.nix and the required-flag tests migrated; VcsGitRepo.worktreeAdd takes
# an options object; the yield tool's wire shape flattened `result.data` to
# `data`; pi-iso grew clone_tree()/skip-list reflinks next to the
# require_cow degradation seam), then 18.2.10 (upstream migrated the UI
# renderers — status line, tool-execution, theme — into @oh-my-pi/pi-tui
# behind host seams, pruned test/task/isolation-runner.test.ts, rewrote
# the auto-thinking classifier around resolveJudge, and moved yield
# section assembly into pi-tui; the status-line patch was re-cut across
# StatusLineHost, the jj e2e test moved to test/task/vcs-jj-e2e.test.ts,
# and omp-isolation-branch-capture-note was dropped as absorbed) in
# patches/omp/.
#
# - omp-jj-colocated-task-refs: isolated-task refs live at refs/omp/task/*
#   (invisible to jj import) — prevents the abandoned-commits incident where
#   a transient branch's post-merge deletion made jj orphan the parent stack.
# - (dropped 17.1.3) omp-isolation-auto-apply: upstream now ships
#   task.isolation.apply (default true) with identical semantics — the
#   distro config sets it false (see afk.nix).
# - omp-isolation-required-flag: the task tool's `isolated` flag becomes a
#   REQUIRED wire field whenever isolation is enabled — a dispatch must
#   choose true/false explicitly, so a forgotten flag is a schema error
#   instead of a silent non-isolated run in the shared worktree.
# - omp-vcs-handle-seam: pure refactor extracting isolated-task VCS ops
#   behind a VcsHandle interface (src/task/vcs.ts). No behavior change.
# - omp-jj-workspace-handle: JjWorkspaceHandle so isolated subagents work in
#   pure jj workspaces (secondary `jj workspace add` trees, non-colocated
#   repos); capture/merge go through jj's backing git store.
# - omp-jj-prompt-instructions: prompt wording only — hardcoded git
#   instructions in system/orchestrate/plan-mode/commit-message prompts
#   mention jj alongside git (`jj st`, git/jj subcommands, `jj describe`).
# - omp-distro-default-settings: adds a distribution-defaults settings layer
#   read from $OMP_DISTRO_CONFIG (YAML), merged below the user's global
#   config.yml — the wrapper ships opinionated defaults without owning the
#   user's config file, so runtime writes (model selection, /settings)
#   persist and override.
# - omp-yield-array-sections: the yield tool's parameter schema
#   (withSectionVariants) advertises the whole array branch for array-valued
#   sections like `findings`, but the per-section validator only accepted a
#   single element and assembly would nest a submitted array one level deep —
#   every reviewer that batched findings burned schema-retry round trips.
#   Array payloads for array-valued sections now validate against the
#   property schema and splat into the section; the tool description says so.
# - omp-streamed-tool-name-rebind: providers may stream a tool call whose
#   name is still a partial prefix when it first surfaces (llama.cpp's
#   chat-diff streaming: stable generated id, name grows "wri" -> "write"),
#   but the TUI bound the pending component's renderer to the first-seen
#   name — write/edit previews rendered as the blank generic fallback until
#   the tool finished. The event controller now displaces and rebuilds the
#   pending component when the streamed name changes. Ships two regression
#   tests (openai parsed-args streaming + growing-name rebind).
# - omp-auto-thinking-ceiling: the `auto` thinking level tops out at high
#   instead of xhigh. `auto` classifies every user turn with a cheap model and
#   xhigh doubles the reasoning budget over high, unsupervised. Since 17.2.1
#   the cap lives in autoEffortCeiling() (upstream's
#   providers.autoThinkingMaxEffort only chooses xhigh vs max), so the ceiling
#   also shapes the classifier prompt: `max` is never offered. Explicit
#   selections are untouched (a pinned level, and the `ultrathink` keyword,
#   which clamps at its own call site, still reach the model's max). Ships one
#   regression test and retargets the five upstream max-opt-in tests.
# - omp-isolation-pinned-backend: an explicit task.isolation.mode is a hard
#   pin — ensureIsolation no longer walks the resolver's fallback chain when
#   a backend is configured. The distro sets overlayfs; a host where the
#   overlay mount fails must fail the spawn loudly instead of silently
#   degrading to rcopy (which drops gitignored files from snapshots).
#   (The distro pinned overlayfs until 2026-08-11; it now pins reflink —
#   overlayfs's lower layer is the parent's LIVE worktree, so captures
#   leaked parent/sibling writes; see the afk backlog.)
# - omp-reflink-degraded-copy: Rust-only, applied in nix/omp-natives.nix
#   (NOT in the list below): the reflink backend degrades per-file to a
#   byte copy on filesystems without FICLONE (ext4/tmpfs) unless
#   StartOptions.require_cow forbids it; iso_start gains an optional
#   4th `options` napi parameter. The regenerated index.d.ts reaches
#   this build through the natives preBuild seam.
# - omp-isolation-require-cow: task.isolation.requireCow (boolean,
#   default false) plumbed settings -> structured-subagent ->
#   isolation-runner -> ensureIsolation -> isoStart options; true
#   restores the hard spawn failure when reflink cannot clone extents.
# - (dropped 18.2.10) omp-isolation-branch-capture-note: upstream's
#   structured-subagent now renders a `capture-error` isolation summary
#   (<system-notification> with result.error, patch path and any rescued
#   branch) for every exitCode-0 run whose changes could not be captured —
#   ahead of the apply=false branch — which is exactly the loud
#   branch->patch downgrade note this patch added after the 2026-08-10
#   incident.
# - omp-goal-no-pause-on-interrupt: a user interrupt no longer pauses an
#   active goal. With interruptMode=wait a typed message queues as a steer,
#   but the empty-Enter queue flush (and Esc) abort the turn with
#   goalReason "interrupted", and onTaskAborted paused the goal
#   unconditionally — every steer-by-double-Enter stranded the goal until a
#   manual /goal resume (2026-08-11: goal dead from 15:08 to session end).
#   onTaskAborted now only flushes usage accounting; /goal pause and the
#   thread-resume auto-pause are untouched. Retargets the upstream
#   pause-on-interrupt regression test to the keep-active contract.
# - omp-anthropic-weekly-reset-priority: Claude subscriptions rank OAuth
#   accounts by their soonest shared 7d window reset (60s tie tolerance)
#   instead of by required drain of expiring headroom, plus
#   sessionStickyOnly identity lookups. Resurrected from the hyperconfig
#   16.3.x personal patch set after the afk consolidation; 17.2.14's
#   deterministic ranking (session-hash + orderPos tiebreak) made the old
#   weighted-sampling test expectations obsolete. 18.x absorbed the old
#   pinSessionCredential() API as upstream pinSessionOAuthAccount (wired to
#   /account); the patch now only folds the remaining delta into it —
#   clearing the pinned credential's reactive rate-limit blocks on fresh
#   manual pins (persisted-session restores keep their blocks).
# - omp-statusline-anthropic-account: the cost segment appends the
#   session-sticky Anthropic OAuth account email (dimmed, 40-col truncated)
#   so the TUI shows which account a multi-subscription session is billed
#   against; a one-shot startup getApiKey warmup attributes the session so
#   the email appears at launch instead of at the first prompt.
# omp-bundled-virtual-modules is DELIBERATELY OMITTED: it is semantically
# incompatible with omp >= 16.4.8 (symbols verified still absent in 17.0.4).
# The hyperconfig patch depends on symbols the 16.4.8 refactor removed
# (BUNDLED_PI_REGISTRY_KEYS, TYPEBOX_BUNDLED_REGISTRY_KEY,
# bundledRegistryVirtualSpecifier); the bundled-module key registry moved from a
# static synchronous Set to an async build-derived Record (BUNDLED_PI_MODULES via
# the omp-legacy-pi-modules virtual module). A fuzzy application compiles but
# crashes the binary at startup (ReferenceError: BUNDLED_PI_REGISTRY_KEYS is not
# defined in __registerLegacyPiBundledVirtualModules). This project ships no
# extensions with runtime @oh-my-pi/* imports, so the bug that patch fixes
# cannot manifest here. Revisit if an extension with a runtime @oh-my-pi/*
# import is ever added.
{
  stdenv,
  omp,
  omp-natives,
}:
let
  rustTarget = stdenv.hostPlatform.rust.rustcTarget;
  # Mirror of upstream's platformsBySystem, restricted to the flake's systems.
  nativeLibBySystem = {
    x86_64-linux = "libpi_natives.so";
    aarch64-linux = "libpi_natives.so";
  };
  nativeLib =
    nativeLibBySystem.${stdenv.hostPlatform.system}
      or (throw "Unsupported platform for omp-patched: ${stdenv.hostPlatform.system}");
in
omp.overrideAttrs (old: {
  patches = (old.patches or [ ]) ++ [
    ../patches/omp/omp-jj-colocated-task-refs.patch
    ../patches/omp/omp-vcs-handle-seam.patch
    ../patches/omp/omp-jj-workspace-handle.patch
    ../patches/omp/omp-jj-prompt-instructions.patch
    ../patches/omp/omp-isolation-required-flag.patch
    ../patches/omp/omp-yield-array-sections.patch
    ../patches/omp/omp-streamed-tool-name-rebind.patch
    ../patches/omp/omp-distro-default-settings.patch
    ../patches/omp/omp-auto-thinking-ceiling.patch
    ../patches/omp/omp-isolation-pinned-backend.patch
    ../patches/omp/omp-isolation-require-cow.patch
    ../patches/omp/omp-goal-no-pause-on-interrupt.patch
    ../patches/omp/omp-anthropic-weekly-reset-priority.patch
    ../patches/omp/omp-statusline-anthropic-account.patch
  ];
  # ── Prebuilt natives seam ─────────────────────────────────────────────
  # The pi-natives Rust addon is built once, from upstream source plus the
  # Rust-affecting patches, in nix/omp-natives.nix (the patches above are
  # TypeScript-only, so the artifact is identical across TS patch
  # iterations). This preBuild neutralizes
  # upstream's Rust steps without editing its buildPhase text, so an upstream
  # rebase that reshuffles buildPhase needs no changes here. Four seams, each
  # aimed at one upstream line:
  #
  # 1. Seed packages/natives/native/ from the prebuilt output. Covers the
  #    napi index.d.ts and the gen-enums index.js (gen-enums writes only
  #    inside native/). Upstream's gen-enums step still re-runs against the
  #    seeded files; it is idempotent and cheap, so it is left alone — hence
  #    --no-preserve=mode, it must be able to rewrite them.
  # 2. Seed target/<rustTarget>/release/<nativeLib> so upstream's
  #    `cp target/.../release/... packages/natives/native/*.node` succeeds.
  # 3. Put a no-op `cargo` shim first on PATH so upstream's
  #    `cargo build --release -p pi-natives ...` becomes a fast no-op.
  # 4. Remove node_modules/.bin/napi: upstream guards its napi dts step with
  #    `[ -x "$napiBin" ]`, and the napi CLI RE-INVOKES cargo (which the shim
  #    would turn into garbage output); deleting the bin makes upstream skip
  #    the step. Its outputs are already covered by (1).
  #
  # If a future patch ever touches packages/natives/**, the seeding in (1)
  # would clobber it at build time — such a patch belongs in omp-natives.nix.
  preBuild = (old.preBuild or "") + ''
    mkdir -p packages/natives/native
    cp -r --no-preserve=mode ${omp-natives}/native/. packages/natives/native/

    mkdir -p target/${rustTarget}/release
    cp --no-preserve=mode ${omp-natives}/lib/${nativeLib} \
      target/${rustTarget}/release/${nativeLib}

    mkdir -p "$TMPDIR/cargo-shim"
    printf '#!%s\nexit 0\n' "${stdenv.shell}" > "$TMPDIR/cargo-shim/cargo"
    chmod +x "$TMPDIR/cargo-shim/cargo"
    export PATH="$TMPDIR/cargo-shim:$PATH"

    rm -f node_modules/.bin/napi
  '';
})
