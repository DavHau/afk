/**
 * direnv — auto-loads direnv environment into the omp agent process.
 *
 * Port of Mic92's pi direnv extension (Mic92/dotfiles,
 * home/.pi/agent/extensions/direnv.ts): runs `direnv export json` on
 * session start and after every bash and eval call, applying the env diff
 * to `process.env`. Commands then run inside the devshell with no
 * `nix develop -c` prefix and no per-command flake re-eval — pair with
 * nix-direnv so the export is a cache read (milliseconds).
 *
 * Where the env lands: the Python eval kernel mirrors live `process.env`
 * on every cell (omp-eval-host-env-sync patch), so a reload reaches the
 * retained kernel on its next cell. omp's persistent native bash shell
 * (bash is off by default in afk) and JS eval workers snapshot the env
 * when spawned and keep the old one.
 *
 * Auto-allow: direnv keys its grants on the .envrc path + content +
 * grant-store location (~/.local/share/direnv/allow). Three agent
 * realities defeat a grant the user already made:
 *   - sandboxed sessions (e.g. sbox) mount a private HOME, so the
 *     user's grant store is invisible and every .envrc is "blocked";
 *   - task-isolation subagents run in copy-on-write clones under
 *     `$OMP_WORKTREE_DIR|~/.omp/wt/t<hex9>/m`, a path the user never
 *     allowed;
 *   - agent edits to a .envrc revoke the grant with nobody around to
 *     re-approve it.
 * So when `direnv export json` fails, `direnv allow` runs once and the
 * export retries. This adds no capability: the agent already executes
 * arbitrary project commands through its bash tool, so gating .envrc
 * execution on an interactive approval protects nothing here.
 * An explicitly `direnv deny`-ed .envrc is still respected: denied
 * exports exit 0 without loading, so the retry never fires for them —
 * only unknown/blocked .envrc (exit 1) get auto-allowed.
 *
 * Requirements: direnv on PATH (allow grants are handled automatically).
 * Status bar: "direnv …" while a load runs, "direnv ✗" on error; cleared
 * on success — a persistent "✓" carries no information and omp renders
 * hook statuses as a bare line floating above the editor.
 *
 * Loaded from $config_dir/extensions/direnv.ts; unit tests in
 * direnv.test.ts, real-direnv integration tests in
 * direnv.integration.test.ts — both run via bun against an oh-my-pi
 * checkout (see the test headers).
 */

import { spawn } from "node:child_process";
import * as path from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

export type DirenvState = "loading" | "ok" | "error";

export interface DirenvRunResult {
	code: number | null;
	stdout: string;
}

export interface DirenvLoaderDeps {
	/** Runs `direnv export json` in `cwd` and resolves with exit code + stdout. */
	run: (cwd: string) => Promise<DirenvRunResult>;
	/** Target env object the export diff is applied to (process.env in production). */
	env: Record<string, string | undefined>;
	/** Inline wait budget; a run outlasting it finishes in the background. */
	timeoutMs?: number;
	/**
	 * Runs `direnv allow` in `cwd`. Invoked when an export fails (blocked
	 * .envrc: sandbox-private grant store, isolation clone, agent-edited
	 * .envrc), then the export retries once. Allow failures (no .envrc,
	 * direnv missing) are ignored; the retry still runs.
	 */
	allow?: (cwd: string) => Promise<DirenvRunResult>;
}

/** Structural subset of ExtensionContext the extension touches. */
export interface DirenvCtx {
	cwd: string;
	hasUI: boolean;
	ui: {
		setStatus(key: string, text: string | undefined): void;
		theme: { fg(color: string, text: string): string };
	};
}

/** Structural subset of ExtensionAPI, for tests. */
export interface DirenvPi {
	on(event: "session_start", handler: (event: unknown, ctx: DirenvCtx) => void | Promise<void>): void;
	on(
		event: "tool_result",
		handler: (
			event: { toolName?: string; input?: Record<string, unknown> },
			ctx: DirenvCtx,
		) => void | Promise<void>,
	): void;
}

/**
 * Apply `direnv export json` output to `env`: string values are set,
 * nulls unset. Empty output means the environment is already in sync.
 */
export function applyDirenvExport(
	output: string,
	env: Record<string, string | undefined>,
): { ok: boolean; loaded: number; unset: number } {
	if (!output.trim()) return { ok: true, loaded: 0, unset: 0 };

	let parsed: unknown;
	try {
		parsed = JSON.parse(output);
	} catch {
		return { ok: false, loaded: 0, unset: 0 };
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		return { ok: false, loaded: 0, unset: 0 };
	}

	let loaded = 0;
	let unset = 0;
	for (const [key, value] of Object.entries(parsed)) {
		if (value === null) {
			delete env[key];
			unset++;
		} else if (typeof value === "string") {
			env[key] = value;
			loaded++;
		}
	}
	return { ok: true, loaded, unset };
}

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Serialized direnv loader: one run in flight at a time (later loads
 * queue behind it), each load blocks callers for at most `timeoutMs` —
 * a slower run completes in the background and still applies its result.
 */
export function createDirenvLoader(deps: DirenvLoaderDeps) {
	const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	// Tail of the run queue; every load chains onto it so runs never overlap,
	// even when a previous load already returned on budget expiry.
	let tail: Promise<void> = Promise.resolve();

	async function runAndApply(cwd: string, onStatus?: (state: DirenvState) => void): Promise<void> {
		let result: DirenvRunResult;
		try {
			result = await deps.run(cwd);
			if (result.code !== 0 && deps.allow) {
				// Blocked .envrc (see header): grant invisible or revoked.
				// Allow, then retry the export once.
				await deps.allow(cwd).catch(() => undefined);
				result = await deps.run(cwd);
			}
		} catch {
			onStatus?.("error");
			return;
		}
		if (result.code !== 0) {
			onStatus?.("error");
			return;
		}
		const applied = applyDirenvExport(result.stdout, deps.env);
		onStatus?.(applied.ok ? "ok" : "error");
	}

	function load(cwd: string, onStatus?: (state: DirenvState) => void): Promise<void> {
		onStatus?.("loading");
		const work = tail.then(() => runAndApply(cwd, onStatus));
		tail = work;

		const { promise: budget, resolve: expire } = Promise.withResolvers<void>();
		const timer = setTimeout(expire, timeoutMs);
		return Promise.race([work, budget]).finally(() => clearTimeout(timer));
	}

	return { load };
}

function themedStatus(ctx: DirenvCtx, state: DirenvState): string | undefined {
	switch (state) {
		case "loading":
			return ctx.ui.theme.fg("warning", "direnv …");
		case "ok":
			// Clear the status: success is the steady state, not news.
			return undefined;
		case "error":
			return ctx.ui.theme.fg("error", "direnv ✗");
	}
}

/** True when the tool_result event is an edit/write that touched a `.envrc`. */
export function isEnvrcMutation(event: { toolName?: string; input?: Record<string, unknown> }): boolean {
	if (event.toolName !== "edit" && event.toolName !== "write") return false;
	const target = event.input?.path;
	return typeof target === "string" && path.basename(target) === ".envrc";
}

/** Wire the loader to session_start, bash/eval, and .envrc edit/write tool results. */
export function createDirenvExtension(pi: DirenvPi, deps: DirenvLoaderDeps): void {
	const loader = createDirenvLoader(deps);

	const statusFor = (ctx: DirenvCtx) =>
		ctx.hasUI
			? (state: DirenvState) => ctx.ui.setStatus("direnv", themedStatus(ctx, state))
			: undefined;

	pi.on("session_start", (_event, ctx) => loader.load(ctx.cwd, statusFor(ctx)));

	// Re-run after every command-running call to pick up .envrc changes
	// (git checkout, direnv allow, ...) — bash, or eval now that afk runs
	// commands from the Python kernel — and after edit/write tool calls that
	// touched a .envrc directly, the usual way an agent (especially an
	// isolated subagent) modifies it.
	pi.on("tool_result", (event, ctx) => {
		const runsCommands = event.toolName === "bash" || event.toolName === "eval";
		if (!runsCommands && !isEnvrcMutation(event)) return;
		return loader.load(ctx.cwd, statusFor(ctx));
	});
}

/** Production deps: real `direnv` child processes against process.env. */
export function createProductionDeps(): DirenvLoaderDeps {
	return {
		env: process.env,
		run: cwd => spawnDirenvProcess(cwd, ["export", "json"]),
		allow: cwd => spawnDirenvProcess(cwd, ["allow"]),
	};
}

function spawnDirenvProcess(cwd: string, args: string[]): Promise<DirenvRunResult> {
	const { promise, resolve } = Promise.withResolvers<DirenvRunResult>();
	const proc = spawn("direnv", args, {
		cwd,
		stdio: ["ignore", "pipe", "ignore"],
	});
	let stdout = "";
	proc.stdout.on("data", (chunk: Buffer) => {
		stdout += chunk.toString();
	});
	proc.on("close", code => resolve({ code, stdout }));
	proc.on("error", () => resolve({ code: null, stdout: "" }));
	return promise;
}

export default function (pi: ExtensionAPI) {
	// Cast: DirenvPi narrows ExtensionAPI's ThemeColor-typed theme.fg to plain
	// strings for testability; the runtime object satisfies both shapes.
	createDirenvExtension(pi as unknown as DirenvPi, createProductionDeps());
}
