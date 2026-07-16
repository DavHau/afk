# omp-patched: omp from llm-agents + the jj-relevant patch set. Originally
# vendored from hyperconfig, rebased onto omp 17.0.0 in patches/omp/. Only
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
# omp-bundled-virtual-modules is DELIBERATELY OMITTED: it is semantically
# incompatible with omp >= 16.4.8 (symbols verified still absent in 17.0.0).
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
{ omp }:
omp.overrideAttrs (old: {
  patches = (old.patches or [ ]) ++ [
    ../patches/omp/omp-jj-colocated-task-refs.patch
    ../patches/omp/omp-isolation-auto-apply.patch
    ../patches/omp/omp-vcs-handle-seam.patch
    ../patches/omp/omp-jj-workspace-handle.patch
    ../patches/omp/omp-jj-prompt-instructions.patch
  ];
})
