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
  # Base interpreter of the managed eval venv (see preHook and
  # ./python-env.nix).
  pythonEnv = import ./python-env.nix { inherit pkgs; };

  # Distribution default settings, loaded via $OMP_DISTRO_CONFIG (the
  # omp-distro-default-settings patch) as a layer BELOW the user's global
  # config.yml — users override any of this at runtime and their writes
  # persist normally. Short rationale comments only, and NO personal
  # system-prompt content. modelRoles pins just the default model (see below);
  # the user's logins and any further model choices stay their own.
  configFile = pkgs.writeText "distro-config.yml" ''
    startup:
      quiet: true
      # Skip the onboarding setup wizard by default; the distribution
      # pre-configures everything the wizard would ask about.
      setupWizard: false
      # afk pins its omp build through nix; upstream's "new version"
      # check can only nag about releases the distro has not adopted.
      checkUpdate: false
    modelRoles:
      # Distribution default model. Users override this in their own
      # config.yml, which layers above this.
      default: anthropic/claude-opus-5:low
      # `@task` is the one role with no inheritance path: it is absent from
      # both the priority chains and shouldInheritDefaultBeforePriority
      # (smol/slow/designer), so it resolves to nothing and the spawn falls
      # back to the parent's bare model string — model without the `:level`
      # suffix. With no explicit level the bundled `task` agent's `auto`
      # frontmatter wins, and auto provisions `high`, so a low-effort parent
      # still spawned high-effort subagents. `@default:<level>` re-attaches a
      # level without pinning a second model: the alias expands to the
      # `default` role's pattern and the trailing suffix overrides its own
      # (`...:low:medium` -> medium). Agents that declare their own
      # `thinking-level` and per-spawn effort hints still take precedence.
      task: "@default:medium"
    skills:
      # The full Superpowers library (afk-skills package output is the skills
      # root) plus the distribution's own skills. Discovered skills reach every
      # subagent's system prompt as skill:// URIs; the superpowers extension
      # injects using-superpowers. Discovery is non-recursive: each directory
      # holds <name>/SKILL.md.
      customDirectories:
        - ${afk-skills}
        - ${../profile/skills}
    isolation:
      # reflink: a real frozen tree (FICLONE per-file clones). overlayfs
      # was pinned here until 2026-08-11, but its lower layer is the
      # parent's LIVE worktree — any file the subagent never wrote read
      # through to the parent's current state, so every capture leaked
      # parent and sibling writes landed mid-run (see
      # backlog/2026-08-10-overlayfs-capture-leaks-parent-writes.md).
      # reflink removes that contamination class by construction. On
      # filesystems without FICLONE (ext4) the backend degrades per-file
      # to a byte copy (omp-reflink-degraded-copy patch): same file set,
      # same freeze, just ~6.6x clone wall and full-copy disk cost.
      # This is still a PIN via omp-isolation-pinned-backend: no silent
      # fallback to rcopy, which would drop gitignored files from
      # snapshots. Hosts that prefer a hard failure over the byte-copy
      # cost set task.isolation.requireCow: true in their own config.yml
      # (the knob from omp-isolation-require-cow).
      # (18.1.13 split the old task.isolation.mode into
      # task.isolation.enabled + isolation.backend.)
      backend: reflink
    task:
      isolation:
        enabled: true
        # merge: branch parks each subagent's commits on
        # refs/omp/task/<id> (the jj-colocated patch).
        # apply: false (upstream task.isolation.apply since 17.1.x;
        # replaces the patched autoApply) so the top-level agent
        # cherry-picks against a clean worktree instead of the harness
        # racing concurrent edits.
        merge: branch
        apply: false
    bash:
      # Python-first distribution: no bash tool. Commands run from eval
      # (`afk_run.run`, `!cmd`) or `hub start`; the Python kernel carries
      # the full devshell environment and follows direnv refreshes
      # (omp-eval-host-env-sync patch). Users re-enable it in their own
      # config.yml.
      enabled: false
      autoBackground:
        # Auto-convert any non-PTY command still running after 10s into a
        # background job. In-process, so it works inside the
        # isolation/sandbox mounts. Kept for users who re-enable bash.
        enabled: true
        thresholdMs: 10000
    eval:
      autoBackground:
        # Same 10s cutoff as bash had: with no bash tool, long builds and
        # test runs happen in eval cells, and a cell blocking the turn for
        # the default 60s (off by default) stalls the whole agent.
        enabled: true
        thresholdMs: 10000
    async:
      # Required for background task subagents and async bash delivery.
      enabled: true
    # Steering messages queue until the in-flight tool call finishes instead
    # of aborting it mid-flight — unattended runs keep their work intact.
    interruptMode: wait
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
      # Distribution default settings (lowest config layer; see configFile).
      OMP_DISTRO_CONFIG = "${configFile}";
      # Consumed by the superpowers extension to locate
      # using-superpowers/SKILL.md for the bootstrap injection.
      OMP_SUPERPOWERS_DIR = "${afk-skills}";
    };
    preHook = ''
      config_dir="$HOME/.omp/profiles/afk/agent"
      mkdir -p "$config_dir/rules" "$config_dir/extensions"
      # Migration: earlier afk versions symlinked config.yml into the Nix
      # store, which silently discarded every runtime settings write (model
      # selection, /settings). Distribution settings now arrive via
      # $OMP_DISTRO_CONFIG; drop the stale symlink so omp can create a real,
      # user-owned config.yml.
      if [ -L "$config_dir/config.yml" ]; then
        rm "$config_dir/config.yml"
      fi
      # The always-applied jj basics rule for the distribution.
      ln -sf ${../profile/rules/jj-basics.md} "$config_dir/rules/jj-basics.md"
      # The always-applied merge protocol for isolated-subagent task refs.
      ln -sf ${../profile/rules/isolated-task-merge.md} "$config_dir/rules/isolated-task-merge.md"
      # Nix/direnv facts about the environment afk itself sets up: devshells
      # are pre-applied by direnv.ts, missing programs come from `nix shell`,
      # and `find /nix/store` is never an option.
      ln -sf ${../profile/rules/afk-devshells.md} "$config_dir/rules/afk-devshells.md"
      ln -sf ${../profile/rules/afk-unavailable-programs.md} "$config_dir/rules/afk-unavailable-programs.md"
      ln -sf ${../profile/rules/afk-nix-store.md} "$config_dir/rules/afk-nix-store.md"
      # Python-first command running: bash is disabled in the distro config.
      ln -sf ${../profile/rules/afk-running-commands.md} "$config_dir/rules/afk-running-commands.md"
      # Read dependency sources out of ~/projects instead of guessing.
      ln -sf ${../profile/rules/afk-dependency-sources.md} "$config_dir/rules/afk-dependency-sources.md"
      # The superpowers bootstrap injector — skills never fire without it.
      ln -sf ${../extensions/superpowers.ts} "$config_dir/extensions/superpowers.ts"
      # direnv auto-load: applies `direnv export json` to the agent process.
      ln -sf ${../extensions/direnv.ts} "$config_dir/extensions/direnv.ts"
      # isolation-guard: blocks isolated subagents from editing or running
      # builds in the original checkout via absolute paths (isolation is a
      # snapshot, not a jail).
      ln -sf ${../extensions/isolation-guard.ts} "$config_dir/extensions/isolation-guard.ts"
      # Migration: the /account extension was dropped once omp shipped
      # `/session pin` over the same pinSessionOAuthAccount API; remove the
      # dangling symlink earlier afk versions left behind.
      if [ -L "$config_dir/extensions/account.ts" ]; then
        rm "$config_dir/extensions/account.ts"
      fi
      # Managed eval venv: omp's kernel falls back to <profile root>/python-env
      # (~/.omp/profiles/afk/python-env; getPythonEnvDir is profile-scoped)
      # when the project has no venv (VIRTUAL_ENV, ./.venv, ./venv still win).
      # Nix-provided libraries via --system-site-packages, `%pip install`
      # for the rest. Recreated when the nix interpreter changes (the
      # marker holds its store path); pip-installed extras do not survive
      # that. A venv without the marker is user-made and left alone.
      # Failure only warns: afk still starts, eval falls back to PATH.
      venv="$HOME/.omp/profiles/afk/python-env"
      marker="$venv/.afk-python"
      if [ ! -e "$venv" ] || { [ -e "$marker" ] && [ "$(cat "$marker")" != "${pythonEnv}" ]; }; then
        mkdir -p "$HOME/.omp/profiles/afk"
        # errexit is off inside an `if` condition: chain with && so a
        # failed step skips the marker and reports.
        if ! (
          exec 9>"$venv.lock" &&
            ${pkgs.util-linux}/bin/flock 9 &&
            # Re-check under the lock: a concurrent afk may have finished it.
            if [ "$(cat "$marker" 2>/dev/null)" != "${pythonEnv}" ]; then
              rm -rf "$venv" &&
                ${pythonEnv}/bin/python3 -m venv --system-site-packages "$venv" &&
                printf '%s' "${pythonEnv}" > "$marker"
            fi
        ); then
          echo "afk: warning: could not create $venv" >&2
        fi
      fi
    '';
  };
in
{
  inherit afk;
}
