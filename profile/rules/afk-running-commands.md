---
alwaysApply: true
---

# Running commands from Python

afk disables the bash tool by default. When there is no `bash` tool in
your tool list, run commands from `eval` with Python. Skills, rules, and
docs that say "run X" or "use bash" mean: run X this way.

- Run commands with `from afk_run import run`:
  `r = run(["cargo", "test"], cwd=..., timeout=600)` returns a
  `CompletedProcess` with text `stdout`/`stderr`. An argv list is the
  default; pass a string only for real shell features (pipes, globs,
  redirects). On timeout or interrupt it kills the command's whole process
  group, so nothing keeps running after the cell gives up; `subprocess.run`
  kills only the direct child. `!cmd` works for a quick look. In a project
  venv without `afk_run`, call `subprocess.run(..., start_new_session=True)`.
- Prefer processing output in Python over pipelines of text tools. Batch
  dependent steps into one cell, check `returncode`, and parse or summarize
  output in Python instead of printing it raw.
- To run somewhere else, pass `cwd=`. Do NOT `os.chdir`: the kernel is
  persistent.
- A cell's deadline defaults to 300s. For longer work raise the cell's
  `timeout` above the command's own `timeout`.
- Remote commands: killing local `ssh` does not stop what it started on the
  remote host. Put the limit on the remote side too:
  `run(["ssh", host, "timeout 60 curl ..."], timeout=90)`. Send multi-line
  remote scripts on stdin instead of nesting quotes:
  `run(["ssh", host, "sh -s"], input=script, timeout=120)`.
- Never `time.sleep` in a cell to wait for work to finish. Start long work
  detached (`hub` `op: "start"` locally; `systemd-run` or `nohup` on a
  remote host) and check on it with short cells.
- Cells running longer than 10s move to the background, and their result
  arrives later. A kernel runs one cell at a time: the next call on it waits
  until the backgrounded cell finishes. Give slow or blocking work (builds,
  remote jobs, downloads) its own kernel, `kernel: "build"`, so the default
  kernel stays free for quick checks. Named kernels have separate state and
  run in parallel, also within one reply. Use `hub` `op: "start"` for
  services, watchers, REPLs, and anything that needs a terminal (a PTY,
  `sudo`, interactive prompts).
- `os.environ` already carries the devshell environment and follows direnv
  reloads before each cell. Do not re-export it or wrap commands in
  `nix develop`.
