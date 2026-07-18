/**
 * direnv integration tests — real `direnv` binary, real filesystem, the
 * production deps (`createProductionDeps`): child-process spawning, the
 * allow-on-failure retry, and the event wiring are all exercised end to
 * end. Grant state is isolated in a temp HOME/XDG_DATA_HOME so the tests
 * never touch (or depend on) the user's real direnv grants — a fresh,
 * empty grant store is exactly the state a sandboxed agent session sees.
 *
 * Run from an oh-my-pi checkout so @oh-my-pi/* resolves, with direnv on
 * PATH (tests self-skip when it is not):
 *   nix shell nixpkgs#bun nixpkgs#direnv -c bun test path/to/afk/extensions/direnv.integration.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	createDirenvExtension,
	createProductionDeps,
	type DirenvLoaderDeps,
	type DirenvPi,
} from "./direnv";

const hasDirenv = Bun.which("direnv") !== null;

// ── Test harness ────────────────────────────────────────────────────────

interface FakeCtx {
	cwd: string;
	hasUI: boolean;
	ui: {
		setStatus: (key: string, text: string | undefined) => void;
		theme: { fg: (color: string, text: string) => string };
	};
}

function makeCtx(cwd: string) {
	const statusLog: Array<[string, string | undefined]> = [];
	const ctx: FakeCtx = {
		cwd,
		hasUI: true,
		ui: {
			setStatus: (key, text) => statusLog.push([key, text]),
			theme: { fg: (color, text) => `[${color}]${text}` },
		},
	};
	return { ctx, statusLog };
}

function makePi() {
	const events = new Map<string, Array<(event: unknown, ctx: FakeCtx) => void | Promise<void>>>();
	const pi = {
		on: (event: string, handler: (event: unknown, ctx: FakeCtx) => void | Promise<void>) => {
			const list = events.get(event) ?? [];
			list.push(handler);
			events.set(event, list);
		},
	} as DirenvPi;
	return { pi, events };
}

async function emit(
	events: Map<string, Array<(event: unknown, ctx: FakeCtx) => void | Promise<void>>>,
	name: string,
	event: unknown,
	ctx: FakeCtx,
) {
	for (const handler of events.get(name) ?? []) {
		await handler(event, ctx);
	}
}

/**
 * Extension instance wired to the REAL direnv binary, with the export
 * applied to a private target object instead of process.env so each test
 * asserts exactly what a load produced.
 */
function makeRealExtension() {
	const env: Record<string, string | undefined> = {};
	const deps: DirenvLoaderDeps = { ...createProductionDeps(), env };
	const { pi, events } = makePi();
	createDirenvExtension(pi, deps);
	return { env, events };
}

// ── Isolated direnv state ───────────────────────────────────────────────
// The production deps spawn direnv inheriting process.env, so isolation
// happens by pointing HOME/XDG dirs at a temp tree for the duration of
// the file. DIRENV_* state vars are cleared: the agent-under-test must
// load the environment itself, not inherit a pre-loaded one.

let root: string;
const savedEnv: Record<string, string | undefined> = {};
const ENV_KEYS = [
	"HOME",
	"XDG_DATA_HOME",
	"XDG_CONFIG_HOME",
	"XDG_CACHE_HOME",
	"DIRENV_CONFIG",
	"DIRENV_DIR",
	"DIRENV_FILE",
	"DIRENV_DIFF",
	"DIRENV_WATCHES",
];

beforeAll(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "afk-direnv-itest-"));
	for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
	const home = path.join(root, "home");
	fs.mkdirSync(home, { recursive: true });
	process.env.HOME = home;
	process.env.XDG_DATA_HOME = path.join(home, ".local", "share");
	process.env.XDG_CONFIG_HOME = path.join(home, ".config");
	process.env.XDG_CACHE_HOME = path.join(home, ".cache");
	process.env.DIRENV_CONFIG = path.join(home, ".config", "direnv");
	delete process.env.DIRENV_DIR;
	delete process.env.DIRENV_FILE;
	delete process.env.DIRENV_DIFF;
	delete process.env.DIRENV_WATCHES;
});

afterAll(() => {
	for (const key of ENV_KEYS) {
		if (savedEnv[key] === undefined) delete process.env[key];
		else process.env[key] = savedEnv[key];
	}
	fs.rmSync(root, { recursive: true, force: true });
});

function makeProject(name: string, envrc: string): string {
	const dir = path.join(root, name);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, ".envrc"), envrc);
	return dir;
}

function grantFiles(): string[] {
	const allowDir = path.join(root, "home", ".local", "share", "direnv", "allow");
	return fs.existsSync(allowDir) ? fs.readdirSync(allowDir) : [];
}

// ── Tests ───────────────────────────────────────────────────────────────

describe.skipIf(!hasDirenv)("direnv integration (real binary)", () => {
	it("main session: session_start auto-allows a blocked .envrc and applies its env", async () => {
		const proj = makeProject("main", 'export AFK_ITEST=main\nexport AFK_OTHER=1\n');
		const { env, events } = makeRealExtension();
		const { ctx, statusLog } = makeCtx(proj);

		expect(grantFiles()).toHaveLength(0); // fresh store = sandboxed-session state
		await emit(events, "session_start", {}, ctx);

		expect(env.AFK_ITEST).toBe("main");
		expect(env.AFK_OTHER).toBe("1");
		// The retry granted the .envrc in the isolated store.
		expect(grantFiles().length).toBeGreaterThan(0);
		// loading → cleared on success.
		expect(statusLog[0]).toEqual(["direnv", "[warning]direnv …"]);
		expect(statusLog.at(-1)).toEqual(["direnv", undefined]);
	});

	it("main session: an agent edit to .envrc revokes the grant, reload re-allows and applies", async () => {
		const proj = makeProject("edit", "export AFK_ITEST=before\n");
		const { env, events } = makeRealExtension();
		const { ctx } = makeCtx(proj);
		await emit(events, "session_start", {}, ctx);
		expect(env.AFK_ITEST).toBe("before");

		// Content change invalidates the grant (direnv hashes path+content).
		fs.writeFileSync(path.join(proj, ".envrc"), "export AFK_ITEST=after\n");
		await emit(events, "tool_result", { toolName: "edit", input: { path: path.join(proj, ".envrc") } }, ctx);
		expect(env.AFK_ITEST).toBe("after");
	});

	it("main session: a bash tool_result reloads a .envrc changed behind the extension's back", async () => {
		const proj = makeProject("bash", "export AFK_ITEST=v1\n");
		const { env, events } = makeRealExtension();
		const { ctx } = makeCtx(proj);
		await emit(events, "session_start", {}, ctx);
		expect(env.AFK_ITEST).toBe("v1");

		fs.writeFileSync(path.join(proj, ".envrc"), "export AFK_ITEST=v2\n");
		await emit(events, "tool_result", { toolName: "bash" }, ctx);
		expect(env.AFK_ITEST).toBe("v2");
	});

	it("subagent: isolation-clone cwd is auto-allowed and loads the origin devshell env", async () => {
		// Origin project, allowed and loaded by the "main session".
		const origin = makeProject("origin", "export AFK_ITEST=devshell\n");
		const main = makeRealExtension();
		const mainCtx = makeCtx(origin);
		await emit(main.events, "session_start", {}, mainCtx.ctx);
		expect(main.env.AFK_ITEST).toBe("devshell");

		// Task-isolation clone: same content, different path (t<9hex>/m
		// mirrors omp's worktree layout) — direnv grants are path-keyed, so
		// the clone starts blocked.
		const clone = path.join(root, "wt", "t0123abcde", "m");
		fs.mkdirSync(clone, { recursive: true });
		fs.copyFileSync(path.join(origin, ".envrc"), path.join(clone, ".envrc"));

		// The subagent session runs the same extension with cwd = clone.
		const sub = makeRealExtension();
		const subCtx = makeCtx(clone);
		await emit(sub.events, "session_start", {}, subCtx.ctx);
		expect(sub.env.AFK_ITEST).toBe("devshell");
		expect(subCtx.statusLog.at(-1)).toEqual(["direnv", undefined]);

		// Subagent edits the clone's .envrc: the grant is revoked with no
		// user around — the reload must re-allow and apply automatically.
		fs.writeFileSync(path.join(clone, ".envrc"), "export AFK_ITEST=sub-edited\n");
		await emit(
			sub.events,
			"tool_result",
			{ toolName: "write", input: { path: path.join(clone, ".envrc") } },
			subCtx.ctx,
		);
		expect(sub.env.AFK_ITEST).toBe("sub-edited");
	});

	it("broken .envrc: both exports fail, status shows the error", async () => {
		const proj = makeProject("broken", "this-command-does-not-exist-afk\nexit 1\n");
		const { env, events } = makeRealExtension();
		const { ctx, statusLog } = makeCtx(proj);
		await emit(events, "session_start", {}, ctx);
		expect(statusLog.at(-1)).toEqual(["direnv", "[error]direnv ✗"]);
		expect(env.AFK_ITEST).toBeUndefined();
	});

	it("directory without .envrc: succeeds as a no-op and clears the status", async () => {
		const dir = path.join(root, "plain");
		fs.mkdirSync(dir, { recursive: true });
		const { env, events } = makeRealExtension();
		const { ctx, statusLog } = makeCtx(dir);
		await emit(events, "session_start", {}, ctx);
		expect(statusLog.at(-1)).toEqual(["direnv", undefined]);
		expect(Object.keys(env)).toHaveLength(0);
	});
});
