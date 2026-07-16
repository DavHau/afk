# afk

**A harness optimized for AFK-mode quality software development.**

Kick off a feature, walk away, come back to reviewed, tested, landed code. afk is an opinionated distribution of [oh-my-pi](https://github.com/can1357/oh-my-pi) tuned for long-running, subagent-driven sessions — the agent orchestrates, delegates, reviews, and integrates on its own.

## What's inside

- **oh-my-pi** as the engine — shipped as one `afk` command, batteries included, nothing to configure.
- **[Superpowers](https://github.com/obra/superpowers) out of the box** — a battle-tested skill library that gives agents a real engineering process: brainstorm before building, plan before coding, test-first, review everything. It exists because agents left to their own devices skip exactly these steps.
- **Superpowers, patched for speed** — upstream executes plans one task at a time. afk rewrites the workflow around parallel waves: every independent task runs concurrently in its own isolated subagent.
- **VCS-agnostic isolated subagents** — every file-editing subagent works in its own overlayfs snapshot. Parallel agents can never conflict while running; their changes come back as tidy patches the orchestrator reviews and merges. Works the same whether the project is git, jj, or neither.
- **Strict testing & review gates** — TDD is mandatory, every task is reviewed against its spec before it may merge, every wave gets a review, and the whole branch gets a final one. No completion claims without fresh verification evidence.
- **jj (Jujutsu) native, git compatible** — the agent drives version control through jj, colocated on top of your plain git repo: history stays ordinary git commits, collaborators and CI see a normal git repo, and you never have to touch jj yourself.
- **direnv integration** — your project devshell is loaded automatically and stays fresh across every command the agent runs.

## The development process

What a session looks like once you say "build X":

1. **Brainstorm** — the agent interrogates the idea one question at a time, proposes approaches, and writes a spec you approve.
2. **Plan** — the spec becomes bite-sized tasks with exact files, code, and tests — plus a dependency map showing which tasks can run in parallel.
3. **Execute in waves** — all ready tasks dispatch at once as isolated implementer subagents. Each follows test-driven development in its own snapshot.
4. **Review before merge** — every finished task is reviewed for spec compliance and code quality *before* its changes touch the tree. Approved work merges; bad work is discarded and redone.
5. **Land** — after a wave-level and a final whole-branch review, the work is described and ready to ship.

You're welcome to interrupt at any checkpoint — but you don't have to be there.
