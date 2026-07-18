# omp-patched: omp from llm-agents + the jj-relevant patch set. Originally
# vendored from hyperconfig, rebased onto omp 17.0.0, re-rebased onto 17.0.4
# (isolation orchestration moved into task/structured-subagent.ts) in
# patches/omp/. Only
# the jj patches ship here; personal patches (account/statusline/output-crop)
# stay out.
#
# - omp-jj-colocated-task-refs: isolated-task refs live at refs/omp/task/*
#   (invisible to jj import) — prevents the abandoned-commits incident where
#   a transient branch's post-merge deletion made jj orphan the parent stack.
# - omp-isolation-auto-apply: adds task.isolation.autoApply (default true);
#   setting it false keeps isolated changes parked on their task ref so a
#   merge queue can cherry-pick against a clean tree.
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
    ../patches/omp/omp-isolation-auto-apply.patch
    ../patches/omp/omp-vcs-handle-seam.patch
    ../patches/omp/omp-jj-workspace-handle.patch
    ../patches/omp/omp-jj-prompt-instructions.patch
    ../patches/omp/omp-distro-default-settings.patch
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
