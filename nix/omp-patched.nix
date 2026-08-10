# omp-patched: omp from llm-agents + the jj-relevant patch set. Originally
# vendored from hyperconfig, rebased onto omp 17.0.0, then 17.0.4 (isolation
# orchestration moved into task/structured-subagent.ts), then 17.2.1 (eval
# isolation tests moved to test/eval/agent-bridge-policy.test.ts; the
# auto-thinking ceiling became upstream's autoEffortCeiling()), then 17.2.12
# (isolation orchestration split into task/isolation-runner.ts; upstream added
# deferred-cleanup tracking and streamed tool-call id re-keying) in
# patches/omp/. Only
# the jj patches ship here; personal patches (account/statusline/output-crop)
# stay out.
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
  ];
  # ── Prebuilt natives seam ─────────────────────────────────────────────
  # The pi-natives Rust addon is built once, from UNPATCHED upstream source,
  # in nix/omp-natives.nix (the patches above are TypeScript-only, so the
  # artifact is identical across patch iterations). This preBuild neutralizes
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
