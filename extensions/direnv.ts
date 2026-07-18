/**
 * direnv — auto-loads direnv environment into the omp agent process.
 *
 * Port of Mic92's pi direnv extension (Mic92/dotfiles,
 * home/.pi/agent/extensions/direnv.ts): runs `direnv export json` on
 * session start and after every bash command, applying the env diff to
 * `process.env`. Commands then run inside the devshell with no
 * `nix develop -c` prefix and no per-command flake re-eval — pair with
 * nix-direnv so the export is a cache read (milliseconds).
 *
 * omp caveat vs pi: omp caches a persistent native shell per session,
 * spawned lazily on the FIRST bash call — it inherits the env applied at
 * session_start, but a mid-session .envrc change only reaches newly
 * spawned processes (eval kernels, subagents, replacement shells), not
 * the already-running cached shell. Accepted; matches the original's
 * process.env-mutation design.
 *
 * Isolated subagents: task-isolation runs execute in-process with cwd set
 * to a copy-on-write clone under `$OMP_WORKTREE_DIR|~/.omp/wt/t<hex9>/m`.
 * direnv keys its grants on the .envrc path + content, so the clone's
 * .envrc is never allowed even when the origin's is — and any .envrc edit
 * inside the clone revokes a grant with no user around to re-approve it.
 * For such sessions (and only when the shared process env carries direnv
 * evidence, i.e. the origin environment actually loaded), `direnv allow`
 * runs before every export: the initial clone gets the origin's grant
 * mirrored, and subagent .envrc edits are re-granted automatically so the
 * reload-after-tool behavior matches the main session. The grant is scoped
 * to the throwaway clone path and adds no capability the subagent's bash
 * tool doesn't already have. .envrc edits made via the edit/write tools
 * also trigger a reload (main sessions included; there it surfaces the
 * usual blocked ✗ until the user re-allows).
 *
 * Requirements: direnv on PATH, `.envrc` allowed (`direnv allow`).
 * Status bar: "direnv …" (running), "direnv ✓" (loaded), "direnv ✗" (error).
 *
 * Loaded from $config_dir/extensions/direnv.ts; tests in direnv.test.ts
 * run via bun against an oh-my-pi checkout (see test header).
 */

import { spawn } from "node:child_process";
import { homedir } from "node:os";
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
	 * Runs `direnv allow` in `cwd`. Invoked before every export when
	 * `autoAllow(cwd)` is true; failures (no .envrc, direnv missing) are
	 * ignored and the export still runs.
	 */
	allow?: (cwd: string) => Promise<DirenvRunResult>;
	/**
	 * Predicate gating the pre-export `allow` call. Production: cwd is a
	 * task-isolation worktree clone AND the shared env shows direnv already
	 * loaded for the origin (DIRENV_DIR set).
	 */
	autoAllow?: (cwd: string) => boolean;
}

/** Structural subset of ExtensionContext the extension touches. */
export interface DirenvCtx {
	cwd: string;
	hasUI: boolean;
	ui: {
		setStatus(key: string, text: string): void;
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
			// Isolated-clone grant: direnv keys grants on path + content, so the
			// clone's .envrc (and any later edit to it) is blocked until allowed.
			// Idempotent and cheap; run unconditionally before the export.
			if (deps.allow && deps.autoAllow?.(cwd)) {
				await deps.allow(cwd).catch(() => undefined);
			}
			result = await deps.run(cwd);
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

function themedStatus(ctx: DirenvCtx, state: DirenvState): string {
	switch (state) {
		case "loading":
			return ctx.ui.theme.fg("warning", "direnv …");
		case "ok":
			return ctx.ui.theme.fg("success", "direnv ✓");
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

/** Wire the loader to session_start, bash, and .envrc edit/write tool results. */
export function createDirenvExtension(pi: DirenvPi, deps: DirenvLoaderDeps): void {
	const loader = createDirenvLoader(deps);

	const statusFor = (ctx: DirenvCtx) =>
		ctx.hasUI
			? (state: DirenvState) => ctx.ui.setStatus("direnv", themedStatus(ctx, state))
			: undefined;

	pi.on("session_start", (_event, ctx) => loader.load(ctx.cwd, statusFor(ctx)));

	// Re-run after every bash command to pick up .envrc changes
	// (cd to a new dir, git checkout, direnv allow, ...), and after
	// edit/write tool calls that touched a .envrc directly — the usual
	// way an agent (especially an isolated subagent) modifies it.
	pi.on("tool_result", (event, ctx) => {
		if (event.toolName !== "bash" && !isEnvrcMutation(event)) return;
		return loader.load(ctx.cwd, statusFor(ctx));
	});
}

/**
 * True when `cwd` sits inside an omp task-isolation worktree clone:
 * `<worktreesDir>/t<9 hex>/<m|merged>[/...]`. Mirrors the layout in
 * omp's task/worktree.ts (TASK_ISOLATION_DIR_PREFIX/-MOUNT_DIR) and
 * cli/worktree-cli.ts (mount dir "m" or "merged").
 */
export function isTaskIsolationWorktree(cwd: string, worktreesDir = defaultWorktreesDir()): boolean {
	const rel = path.relative(path.resolve(worktreesDir), path.resolve(cwd));
	if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return false;
	const [segment, mount] = rel.split(path.sep);
	if (!segment || !/^t[0-9a-f]{9}$/.test(segment)) return false;
	return mount === "m" || mount === "merged";
}

/**
 * omp's agent-managed worktree base: `$OMP_WORKTREE_DIR` (absolute, `~`
 * expanded) falling back to `~/.omp/wt`. Replicated from pi-utils
 * getWorktreesDir() because extensions in this build must not import
 * `@oh-my-pi/*` at runtime (see nix/omp-patched.nix on the omitted
 * bundled-virtual-modules patch). The `worktree.base` setting override is
 * not visible here; afk does not set it.
 */
function defaultWorktreesDir(): string {
	const fromEnv = process.env.OMP_WORKTREE_DIR;
	if (fromEnv) {
		const expanded = fromEnv === "~" || fromEnv.startsWith("~/") ? path.join(homedir(), fromEnv.slice(1)) : fromEnv;
		if (path.isAbsolute(expanded)) return expanded;
	}
	return path.join(homedir(), ".omp", "wt");
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
	const direnvPi = pi as unknown as DirenvPi;
	createDirenvExtension(direnvPi, {
		env: process.env,
		run: cwd => spawnDirenvProcess(cwd, ["export", "json"]),
		allow: cwd => spawnDirenvProcess(cwd, ["allow"]),
		// Auto-allow only inside task-isolation clones, and only when direnv
		// evidence exists in the (process-wide, shared) env — DIRENV_DIR is
		// set iff an origin .envrc was allowed and actually loaded, either by
		// the main session's extension instance or by the launching shell.
		autoAllow: cwd => isTaskIsolationWorktree(cwd) && Boolean(process.env.DIRENV_DIR),
	});
}
