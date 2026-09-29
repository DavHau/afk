---
alwaysApply: true
---

# Running commands from Python

afk disables the bash tool by default. When there is no `bash` tool in
your tool list, run commands from `eval` with Python. Skills, rules, and
docs that say "run X" or "use bash" mean: run X this way.

- A single command: `subprocess.run(["cargo", "test"], cwd=..., capture_output=True, text=True)`
  with an argv list, not a shell string. `!cmd` works for a quick look.
- Use `shell=True` only for real shell features (pipes, globs, redirects).
  Prefer processing output in Python over pipelines of text tools.
- Batch dependent steps into one cell, check `returncode`, and parse or
  summarize output in Python instead of printing it raw.
- To run somewhere else, pass `cwd=` to `subprocess`. Do NOT `os.chdir`: the
  kernel is persistent and may be shared with other agents.
- Cells running longer than 10s move to the background, and their result
  arrives later. Use `hub` `op: "start"` for services, watchers, REPLs, and
  anything that needs a terminal (a PTY, `sudo`, interactive prompts).
- `os.environ` already carries the devshell environment and follows direnv
  reloads before each cell. Do not re-export it or wrap commands in
  `nix develop`.
