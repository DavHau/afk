# SDD fix loop drops TDD discipline (no fix-dispatch template)

Filed: 2026-08-08
Area: `patches/superpowers/skills-subagent-driven-development.patch` (skill: `subagent-driven-development`)
Severity: Important — silently degrades the one stage whose whole purpose is regression coverage.

**RESOLVED 2026-08-11.** Implemented as proposed:

1. `patches/superpowers/skills-sdd-fixer-prompt.patch` (new): creates
   `skills/subagent-driven-development/fixer-prompt.md` — per-finding
   RED → GREEN work order (reproduce as a failing test first, confirm it
   fails for the finding's reason, minimal fix, re-run green with pristine
   output), the `NOT TESTABLE: <why>` escape hatch stated so fixers do not
   fake evidence, the `## Fix Round R` report contract, and the same
   handoff discipline as the sibling templates (isolated: true as a
   tool parameter, repo-relative brief, local:// report, [TEST_FILES],
   no git/jj).
2. `skills-subagent-driven-development.patch` amended: §4's
   fix-then-test sentence replaced with the test-first paragraph,
   `Template: [fixer-prompt.md](fixer-prompt.md)` added, and the
   "write the test after" row added to Common Rationalizations. The string
   "The fixer fixes, re-runs the tests" is gone from the built skill.
3. `skills-re-review-prompt.patch` amended: the Tests section demands
   per-finding RED evidence (or an accepted NOT TESTABLE justification),
   a green-only regression test verdicts NOT ADDRESSED, and Finding
   Verdicts cite the RED evidence alongside file:line.

Verified: all patches apply to the pinned upstream with zero fuzz;
`nix build .#afk-skills` succeeds; built output carries all four templates
(asserted by a new rebase-guard test in `tests/distro-config.test.ts`, 7/7
passing). Dry run (AC9): a two-finding fix dispatch composed from the
template needs only the five placeholders — the template is self-contained;
no other skill text required changes.

## Incident

A controller session was executing `subagent-driven-development` (SDD) against
an implementation plan in a sibling project (`mmm`, research/backtest
pipeline). Waves of isolated implementer subagents were dispatched from
bite-sized plan tasks; every implementer prompt mandated TDD (write the test,
watch it fail, implement, watch it pass) because the PLAN's task steps are
written that way, and the implementer template asks for RED/GREEN evidence in
the report.

Timeline:

1. Waves 1 and 2 ran normally. Implementers reported TDD evidence per task;
   task reviews and the wave reviews gated the merges.
2. The wave-2 review returned 8 findings (2 correctness-class, 6 interface /
   contract-class).
3. The controller composed the fix dispatch (`Wave2Fix`) straight from the
   skill's fix-loop prose: implement the fixes, add or extend tests that would
   have caught each finding, run the covering test files, append the fix report.
   **No test-first ordering was required** — nothing told the fixer to write a
   failing regression test per finding and observe it fail *before* touching
   the production code.
4. The human partner caught this before the fixer's ref was merged, killed the
   fix subagent, and relaunched it with explicit per-finding RED → GREEN
   instructions.

### Why it matters

The fix loop is precisely where regression tests earn their keep: each finding
is a *known, already-observed defect*, so a reproduction test is both cheap and
maximally informative. Fixing first and testing after inverts that:

- A test written after the fix passes on its first run, which proves nothing
  about whether it can catch the defect. Per `test-driven-development`
  SKILL.md, "Tests written after pass immediately — which proves nothing."
- A non-fix is indistinguishable from a fix. If the fixer misdiagnoses the
  finding, the after-the-fact test is written against the code it just wrote,
  goes green, and the scoped re-review sees a report with covering tests and
  passing output — exactly what the skill tells it to accept.
- The defect class is not pinned. Test-after tends to assert the shape of the
  new code; test-first asserts the behaviour the finding described.
- It is a *silent* degradation: implementers are held to RED/GREEN and report
  it; fixers are not, and no artifact records the difference. Only a human
  reading the dispatch prompt noticed.

Cost this time: one killed subagent and one relaunch. Cost in the general case:
a merged fix ref that never fixed anything, with green tests attached.

## Root cause

Every other stage of the SDD loop has a prompt template that carries its
discipline. The fix stage has only prose, and the prose omits ordering.

Source of truth for the skill text is the afk patch (the skills tree is built
as `src + patches` by `nix/afk-skills.nix`; forked skill sources are
prohibited). Line numbers below are from the **built** skill at
`$OMP_SUPERPOWERS_DIR/subagent-driven-development/`, with the corresponding
hunk in `patches/superpowers/skills-subagent-driven-development.patch`.

**1. No fix-dispatch template exists.** The skill directory ships exactly three
dispatch templates:

```
subagent-driven-development/
  SKILL.md
  implementer-prompt.md
  task-reviewer-prompt.md
  re-review-prompt.md
  scripts/{sdd-workspace,task-brief,review-package}
```

`SKILL.md:280` ends step 1 with `Template: [implementer-prompt.md](implementer-prompt.md)`
and `SKILL.md:353` ends step 3 with `Template: [task-reviewer-prompt.md](task-reviewer-prompt.md)`.
Step 4, "The fix loop" (`SKILL.md:355`–`SKILL.md:425`), has **no `Template:` line**.
The controller composes the fix prompt freehand, from prose, every time.

**2. The prose it composes from specifies test-after, not test-first.**
`SKILL.md:377-385` (patch file lines 516–524):

> **Every round:** a parked implementer cannot be resumed — its snapshot is
> gone once the harness captures it. Dispatch a fresh isolated fix subagent
> carrying the brief's repo-relative path, the `local://` report URI, and the
> open findings verbatim; the report file is the persistent memory across
> rounds. **The fixer fixes, re-runs the tests covering the amended code,**
> appends its fix report to the same report file, and returns the short
> contract. Name the covering test files in the fix dispatch — a one-line fix
> does not need the whole suite. **Before dispatching the re-review, confirm the
> fix report contains the covering tests, the command run, and the output.**

"The fixer fixes, re-runs the tests covering the amended code" is a literal
fix-then-test instruction. The controller's acceptance check ("covering tests,
the command run, and the output") is satisfiable by a green-only run. A
faithful controller following this text produces exactly the dispatch that was
killed.

**3. TDD is delegated to task text the fixer never receives.** The implementer
template does not mandate TDD on its own authority —
`implementer-prompt.md:42-43`:

> 1. Implement exactly what the task specifies
> 2. Write tests (**following TDD if task says to**)

TDD reached the wave-1/2 implementers only because the plan's task steps said
so, and it survived into the report because `implementer-prompt.md:135-137`
asks for it conditionally:

> - **TDD Evidence** (if TDD was required for this task):
>   - RED: command run, relevant failing output before implementation, and why the failure was expected
>   - GREEN: command run and relevant passing output after implementation

A fix dispatch carries *findings*, not plan task steps. The conditional is
never satisfied, so both the mandate and the evidence requirement evaporate at
the fix stage.

**4. Neither reviewer catches the omission.** `task-reviewer-prompt.md:64-67`
assumes the evidence exists ("The implementer already ran the tests and
reported results with TDD evidence for exactly this code"), and the scoped
re-review — the only reviewer that ever looks at a fix diff — asks only for
green. `re-review-prompt.md:55-61`:

> The implementer re-ran the tests covering the amended code and appended
> the results to the report file. Treat the report as unverified claims:
> confirm the fix report **names the covering tests and shows their output**,
> and verify the claims against the diff.

No RED evidence is requested, so "ADDRESSED" can be verdicted on a test that
never failed.

**5. The generic TDD skill does not close the hole.**
`test-driven-development` SKILL.md is unambiguous — "NO PRODUCTION CODE
WITHOUT A FAILING TEST FIRST"; "Bug found? Write failing test reproducing it.
Follow TDD cycle. Test proves fix and prevents regression. Never fix bugs
without a test." — and a review finding is a bug by any reading. But nothing
in SDD's fix loop references it, and subagents start blank: a fixer inherits
no session history and reads only the skills its dispatch prompt sends it to.
Two correct skills, no wire between them.

**Verdict: hypothesis confirmed.** The gap is structural (missing template) and
textual (fix-then-test prose plus a green-only acceptance check), not a
controller mistake.

## Proposal

Minimal, in the skill's existing idiom: one new template, two small text
amendments. All three as patches under `patches/superpowers/` — new-file
patches (`--- /dev/null`) apply cleanly under stdenv's `patch -p1`, so the
"no forked skill sources" rule in `nix/afk-skills.nix` is respected.

### 1. New: `skills/subagent-driven-development/fixer-prompt.md`

Same shape as `implementer-prompt.md` / `re-review-prompt.md`: a prose preamble
about placeholders, one fenced dispatch block, a `**Placeholders:**` list, and
a `**Fixer returns:**` line. Content requirements:

- `isolated: true` stated as a task-tool parameter; agent per SKILL.md Agent
  Selection (rounds 4-5 bump).
- `[BRIEF_FILE]` repo-relative, `[REPORT_URI]` as `local://task-N-report.md`,
  `[FINDINGS]` verbatim one per bullet, `[TEST_FILES]` naming the covering
  tests — the same handoff discipline as the other templates, no absolute
  paths.
- **The per-finding cycle, stated as the work order:**
  1. Reproduce the finding as a failing test first — extend an existing
     covering test file where one exists.
  2. Run it. Confirm it fails, and that it fails *for the finding's reason*,
     not a typo or import error.
  3. Fix the production code minimally.
  4. Re-run. Confirm green, output pristine, neighbours still green.
- The finding-shaped escape hatch, stated explicitly so fixers do not fake
  evidence: some findings are not behaviourally testable (naming, dead code,
  a comment, a pure refactor). For those, write `NOT TESTABLE: <why>` in the
  fix report instead of RED/GREEN. Anything with observable behaviour —
  wrong value, wrong contract, missing validation, wrong ordering — is
  testable and gets the cycle.
- Report contract: append to `[REPORT_URI]` a **Fix Round R** section with, per
  finding, the finding one-liner, `RED:` command + relevant failing output +
  why that failure was expected, `GREEN:` command + passing output, and the
  files changed — or the `NOT TESTABLE` line with its justification.
- Same short return contract as the implementer template (status, files
  changed, one-line test summary, concerns, report URI); no git/jj.

### 2. Amend `SKILL.md` §4 "The fix loop"

Replace the fix-then-test sentence at `SKILL.md:381-385`. Target text:

> The fixer reproduces each finding as a failing test first, watches it fail
> for the finding's reason, then fixes — a review finding is a known defect,
> and a test written after the fix passes on its first run, proving nothing.
> It appends a per-finding RED/GREEN fix report to the same report file and
> returns the short contract. Name the covering test files in the fix dispatch
> — a one-line fix does not need the whole suite. Before dispatching the
> re-review, confirm the fix report shows, per finding, the failing run before
> the fix and the passing run after (or `NOT TESTABLE: <why>` for findings
> with no observable behaviour).

Add, after that paragraph, matching steps 1 and 3:

> Template: [fixer-prompt.md](fixer-prompt.md)

Add one row to the Common Rationalizations table:

| "The fix is obvious, I'll write the test after" | A test written after the fix passes immediately and proves nothing — including when the fix is wrong. Findings are known defects: reproduce, watch it fail, then fix. |

### 3. Amend `re-review-prompt.md` "Tests"

Extend `re-review-prompt.md:55-61` so the re-review verifies the evidence it is
now guaranteed: confirm the fix report shows a failing run *before* the fix and
a passing run after, **per finding** (or an accepted `NOT TESTABLE`
justification), and treat a finding whose regression test only ever ran green
as **NOT ADDRESSED** — the fix is unproven. Add the corresponding requirement to
the Finding Verdicts section: cite the RED evidence alongside the file:line.

Not proposed (deliberately): mandating TDD unconditionally in
`implementer-prompt.md`. That template's conditional correctly defers to the
plan's task text, which the plan-writing skills own. The fix loop has no task
text, which is exactly why it needs its own mandate.

## Acceptance criteria

1. `patches/superpowers/` gains a new-file patch creating
   `skills/subagent-driven-development/fixer-prompt.md`, plus amendments to the
   SDD `SKILL.md` and `re-review-prompt.md` patches — each carrying the "What
   must survive a rebase" preamble in the established style.
2. `nix build` of `afk-skills` succeeds; all patches apply to the pinned
   upstream with no fuzz.
3. In the built skill output, `subagent-driven-development/fixer-prompt.md`
   exists, and `SKILL.md` §4 contains `Template: [fixer-prompt.md](fixer-prompt.md)`.
4. `SKILL.md` contains no remaining fix-then-test phrasing: the string
   "The fixer fixes, re-runs the tests" is gone.
5. `fixer-prompt.md` states the per-finding RED → GREEN order, the "verify the
   failure is for the finding's reason" step, the `NOT TESTABLE` escape hatch
   with justification, and the per-finding report contract.
6. `re-review-prompt.md` requires per-finding RED evidence and makes a
   green-only regression test a NOT ADDRESSED verdict.
7. Handoff discipline preserved in the new template: `isolated: true` as a
   tool parameter, repo-relative brief path, `local://` report URI, no absolute
   paths, no git/jj in the fixer.
8. `tests/distro-config.test.ts` still passes (skills root still discovered);
   optionally extend it to assert the four SDD templates exist, so a rebase
   that drops one fails loudly.
9. Dry run: compose a fix dispatch from the new template for a two-finding
   review and confirm nothing else in the skill needs to change to make it
   self-contained.
