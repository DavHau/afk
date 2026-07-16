# afk.nix — the generated profile config.yml and the wrapped `afk` binary.
# Pattern reference: oml's nix/oml.nix (wrapPackage: env, filesToExclude,
# preHook symlinking profile assets), minus the loop engine.
{
  pkgs,
  wrapPackage,
  omp-patched,
  afk-skills,
}:
let
  # Generated config.yml. Short rationale comments only; NO modelRoles (the
  # user's login/models are their own) and NO personal system-prompt content.
  configFile = pkgs.writeText "config.yml" ''
    startup:
      quiet: true
      # The onboarding setup wizard bumps setupVersion on completion, but
      # config.yml is a read-only Nix-store symlink so the write never
      # persists — it would re-run every launch. Disable it outright.
      setupWizard: false
    skills:
      # The full Superpowers library (afk-skills package output is the skills
      # root). Discovered skills reach every subagent's system prompt as
      # skill:// URIs; the superpowers extension injects using-superpowers.
      customDirectories:
        - ${afk-skills}
    task:
      isolation:
        # overlayfs: read-only lower layer + copy-up on write, in-process so
        # it works inside the sandbox namespace. merge: branch parks each
        # subagent's commits on refs/omp/task/<id> (the jj-colocated patch).
        # autoApply: false so the top-level agent cherry-picks against a
        # clean worktree instead of the harness racing concurrent edits.
        mode: overlayfs
        merge: branch
        autoApply: false
    bash:
      autoBackground:
        # Auto-convert any non-PTY command still running after 10s into a
        # background job. In-process, so it works inside the
        # isolation/sandbox mounts.
        enabled: true
        thresholdMs: 10000
    async:
      # Required for background task subagents and async bash delivery.
      enabled: true
  '';

  afk = wrapPackage {
    inherit pkgs;
    package = omp-patched;
    binName = "afk";
    # The symlink join re-exposes the unwrapped package's bin/omp, which
    # would shadow the wrapper intent; drop it so only bin/afk ships.
    filesToExclude = [ "bin/omp" ];
    # jj + git for the colocated workflow, bun for eval cells and extension
    # tests. runtimeInputs are prepended to PATH by writeShellApplication.
    runtimeInputs = [
      pkgs.jujutsu
      pkgs.git
      pkgs.bun
    ];
    env = {
      # Named profile: omp derives every user-level path (config, rules,
      # extensions, sessions, agent.db) from ~/.omp/profiles/afk/agent.
      OMP_PROFILE = "afk";
      # Consumed by the superpowers extension to locate
      # using-superpowers/SKILL.md for the bootstrap injection.
      OMP_SUPERPOWERS_DIR = "${afk-skills}";
    };
    preHook = ''
      config_dir="$HOME/.omp/profiles/afk/agent"
      mkdir -p "$config_dir/rules" "$config_dir/extensions"
      ln -sf ${configFile} "$config_dir/config.yml"
      # The always-applied jj basics rule for the distribution.
      ln -sf ${../profile/rules/jj-basics.md} "$config_dir/rules/jj-basics.md"
      # The superpowers bootstrap injector — skills never fire without it.
      ln -sf ${../extensions/superpowers.ts} "$config_dir/extensions/superpowers.ts"
      # direnv auto-load: applies `direnv export json` to the agent process.
      ln -sf ${../extensions/direnv.ts} "$config_dir/extensions/direnv.ts"
    '';
  };
in
{
  inherit afk;
}
