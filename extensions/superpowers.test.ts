/**
 * Superpowers bootstrap tests — the injected OMP tool mapping must match
 * this distribution's isolation model (isolated task subagents, parked
 * refs, no manual worktrees). Run:
 *   bun test extensions/superpowers.test.ts
 */
import { describe, expect, it } from "bun:test";
import { BOOTSTRAP_MARKER, buildBootstrap } from "./superpowers";

const bootstrap = buildBootstrap("---\nname: using-superpowers\n---\nSkill body.");

describe("buildBootstrap", () => {
	it("wraps the skill body with the marker", () => {
		expect(bootstrap).toContain(BOOTSTRAP_MARKER);
		expect(bootstrap).toContain("Skill body.");
	});

	it("never instructs manual worktree or workspace creation", () => {
		expect(bootstrap).not.toContain("jj workspace add");
		expect(bootstrap).not.toContain("git worktree add");
		expect(bootstrap).toContain("NEVER create git worktrees or jj workspaces");
	});

	it("routes file-editing dispatches through isolated subagents and the merge rule", () => {
		expect(bootstrap).toContain("isolated: true");
		expect(bootstrap).toContain("isolated-task-merge");
	});

	it("maps skill subagent roles to bundled omp agent types", () => {
		for (const agent of ["`reviewer`", "`scout`", "`librarian`", "`sonic`", "`task`"]) {
			expect(bootstrap).toContain(agent);
		}
		expect(bootstrap).toContain("no per-dispatch model");
	});
});
