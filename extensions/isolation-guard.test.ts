/**
 * Isolation-guard extension tests. Run from an oh-my-pi checkout so the
 * @oh-my-pi/* workspace packages resolve (node_modules symlink next to
 * this file):
 *   nix shell nixpkgs#bun -c bun test path/to/afk/extensions/isolation-guard.test.ts
 */
import { describe, expect, it } from "bun:test";
import { loadExtensions } from "@oh-my-pi/pi-coding-agent/extensibility/extensions";
import * as os from "node:os";
import * as path from "node:path";
import {
	createIsolationGuard,
	evaluateToolCall,
	findIsolationRoot,
	type GuardPi,
	type GuardToolCallEvent,
	type GuardVerdict,
} from "./isolation-guard";

const ROOT = "/home/u/.omp/profiles/afk/wt/td45ae6307/m";
const PARENT = "/home/u/synced/projects/VibePN";

describe("findIsolationRoot", () => {
	it("recognizes the t<hex9>/m layout at the cwd and above it", () => {
		expect(findIsolationRoot(ROOT)).toBe(ROOT);
		expect(findIsolationRoot(path.join(ROOT, "crates", "core"))).toBe(ROOT);
	});

	it("returns undefined for ordinary project directories", () => {
		expect(findIsolationRoot(PARENT)).toBeUndefined();
		expect(findIsolationRoot("/home/u/wt/tXYZ/m")).toBeUndefined(); // not 9 hex
		expect(findIsolationRoot("/home/u/wt/t012345678/x")).toBeUndefined(); // no mount segment
	});
});

/** The exact escape observed in the 2026-07-18 VibePN sessions. */
describe("evaluateToolCall — bash", () => {
	it("blocks an explicit parent-repo cwd", () => {
		const verdict = evaluateToolCall(
			{ toolName: "bash", input: { command: "cargo test -p vibepn-core invite", cwd: PARENT } },
			ROOT,
		);
		expect(verdict?.block).toBe(true);
		expect(verdict?.reason).toContain(PARENT);
		expect(verdict?.reason).toContain(ROOT);
	});

	it("blocks a leading `cd <parent> && …` even without a cwd argument", () => {
		const verdict = evaluateToolCall(
			{ toolName: "bash", input: { command: `cd ${PARENT} && cargo test` } },
			ROOT,
		);
		expect(verdict?.block).toBe(true);
	});

	it("allows worktree, relative, and scratch cwds", () => {
		expect(evaluateToolCall({ toolName: "bash", input: { command: "cargo test", cwd: ROOT } }, ROOT)).toBeUndefined();
		expect(
			evaluateToolCall({ toolName: "bash", input: { command: "cargo test", cwd: "crates/core" } }, ROOT),
		).toBeUndefined();
		expect(
			evaluateToolCall({ toolName: "bash", input: { command: "ls", cwd: os.tmpdir() } }, ROOT),
		).toBeUndefined();
		expect(evaluateToolCall({ toolName: "bash", input: { command: `cd sub && ls` } }, ROOT)).toBeUndefined();
	});

	it("leaves shell-expanded cd targets to the shell", () => {
		expect(
			evaluateToolCall({ toolName: "bash", input: { command: "cd $HOME/elsewhere && ls" } }, ROOT),
		).toBeUndefined();
	});

	it("never blocks in a non-isolated session", () => {
		expect(
			evaluateToolCall({ toolName: "bash", input: { command: "cargo test", cwd: PARENT } }, PARENT),
		).toBeUndefined();
	});
});

describe("evaluateToolCall — write", () => {
	it("blocks absolute parent-repo targets, allows worktree/relative/internal-URL targets", () => {
		expect(
			evaluateToolCall({ toolName: "write", input: { path: `${PARENT}/crates/x.rs`, content: "" } }, ROOT)?.block,
		).toBe(true);
		expect(
			evaluateToolCall({ toolName: "write", input: { path: `${ROOT}/crates/x.rs`, content: "" } }, ROOT),
		).toBeUndefined();
		expect(evaluateToolCall({ toolName: "write", input: { path: "crates/x.rs", content: "" } }, ROOT)).toBeUndefined();
		expect(
			evaluateToolCall({ toolName: "write", input: { path: "local://task-5-report.md", content: "" } }, ROOT),
		).toBeUndefined();
	});

	it("expands ~ before judging", () => {
		const home = os.homedir();
		const outside = `~${path.sep}outside.md`;
		const verdict = evaluateToolCall({ toolName: "write", input: { path: outside, content: "" } }, ROOT);
		expect(verdict?.block).toBe(true);
		expect(verdict?.reason).toContain(path.join(home, "outside.md"));
	});

	it("inspects xd://ast_edit JSON paths and fails open on malformed JSON", () => {
		const escape = JSON.stringify({ ops: [{ pat: "a", out: "b" }], paths: [`${PARENT}/src`] });
		expect(
			evaluateToolCall({ toolName: "write", input: { path: "xd://ast_edit", content: escape } }, ROOT)?.block,
		).toBe(true);
		const inside = JSON.stringify({ ops: [], paths: ["src", `${ROOT}/crates`] });
		expect(
			evaluateToolCall({ toolName: "write", input: { path: "xd://ast_edit", content: inside } }, ROOT),
		).toBeUndefined();
		expect(
			evaluateToolCall({ toolName: "write", input: { path: "xd://ast_edit", content: "{oops" } }, ROOT),
		).toBeUndefined();
	});
});

describe("evaluateToolCall — edit", () => {
	it("blocks hashline section headers that address the parent tree", () => {
		const input = `[${PARENT}/crates/ctl/src/node.rs#831E]\nSWAP 1.=1:\n+x`;
		const verdict = evaluateToolCall({ toolName: "edit", input: { input } }, ROOT);
		expect(verdict?.block).toBe(true);
	});

	it("blocks ~-form headers (as rendered by the edit tool)", () => {
		const input = `[~/synced/projects/VibePN/crates/ctl/tests/node.rs#2A2F]\nDEL 3`;
		expect(evaluateToolCall({ toolName: "edit", input: { input } }, ROOT)?.block).toBe(true);
	});

	it("allows relative and worktree headers", () => {
		expect(
			evaluateToolCall({ toolName: "edit", input: { input: "[crates/core/src/invite.rs#2ABC]\nDEL 3" } }, ROOT),
		).toBeUndefined();
		expect(
			evaluateToolCall({ toolName: "edit", input: { input: `[${ROOT}/crates/core/src/invite.rs#2ABC]\nDEL 3` } }, ROOT),
		).toBeUndefined();
	});
});

describe("createIsolationGuard", () => {
	it("wires evaluateToolCall onto tool_call with the session cwd", () => {
		let handler: ((event: GuardToolCallEvent, ctx: { cwd: string }) => GuardVerdict | undefined) | undefined;
		const pi: GuardPi = {
			on: (_event, h) => {
				handler = h;
			},
		};
		createIsolationGuard(pi);
		expect(handler).toBeDefined();
		const verdict = handler?.({ toolName: "bash", input: { command: "ls", cwd: PARENT } }, { cwd: ROOT });
		expect(verdict?.block).toBe(true);
		expect(handler?.({ toolName: "read", input: { path: PARENT } }, { cwd: ROOT })).toBeUndefined();
	});
});

describe("extension loading", () => {
	it("loads under omp's real extension loader without errors", async () => {
		const result = await loadExtensions([`${import.meta.dir}/isolation-guard.ts`], "/tmp");
		expect(result.errors).toEqual([]);
		expect(result.extensions).toHaveLength(1);
	});
});
