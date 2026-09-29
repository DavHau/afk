---
alwaysApply: true
---

# Nix devshells are auto-loaded

The project devshell is already active: the direnv extension applies the
`.envrc` environment (`direnv export json`) to the agent process at session
start and again after every bash or eval call. Devshell tools are on PATH in
every command you run, including `subprocess` calls from the Python kernel.

- Do NOT prefix commands with `nix develop -c`, `nix develop --command`, or
  `nix-shell --run` to reach project devshell tools — that re-evaluates the
  flake per command (seconds of overhead) for an environment you already have.
- If an expected devshell tool is missing, the directory likely has no allowed
  `.envrc`: check `direnv status`, then `direnv allow` once.
- After editing `.envrc`/`flake.nix`, the refreshed env reaches the Python
  kernel's `os.environ` at the next cell and every newly spawned process; the
  persistent bash shell (when enabled) and JS eval keep the old one.
- Programs outside the project devshell still follow the unavailable-programs
  rule: reach them via `nix shell`, never by installing.
