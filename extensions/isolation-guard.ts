/**
 * isolation-guard — blocks isolation escapes in isolated task subagents.
 *
 * Why: isolation is a snapshot, not a jail. An isolated subagent whose
 * dispatch prompt mentions an absolute path into the original checkout
 * will happily read, edit, and build THERE — bypassing isolation
 * entirely: its parked task ref comes back empty while the shared
 * worktree silently accumulates its changes. Real sessions hit exactly
 * this (2026-07-18 VibePN: two implementers did 100% of their edits and
 * cargo runs in the parent tree). Prompt-level rules reduce the
 * frequency; this guard makes the escape structurally impossible.
 *
 * Mechanism: on every `tool_call` in a session whose cwd lies inside a
 * task-isolation snapshot (`…/t<9 hex>/m/…`, see omp's
 * task/worktree.ts TASK_ISOLATION_DIR_PREFIX/_MOUNT_DIR), block
 *   - `write` whose target resolves outside the snapshot,
 *   - `edit` whose section headers (`[path#tag]`) resolve outside,
 *   - `write` to `xd://ast_edit` whose JSON `paths` resolve outside,
 *   - `bash` whose `cwd` (or leading `cd <dir> && …`, mirroring the
 *     bash tool's own extraction) resolves outside.
 * Reads stay unrestricted; scratch writes to the OS tempdir, /tmp, and
 * /var/tmp are allowed; internal URLs (`local://`, `xd://`, …) pass —
 * `local://` is the sanctioned shared channel for briefs/reports.
 *
 * Non-goals: absolute paths buried inside bash command text (e.g.
 * `cargo --manifest-path /abs/...`) are not parsed; this covers the
 * observed escape vectors, not a sandbox guarantee.
 *
 * Loaded from $config_dir/extensions/isolation-guard.ts; tests in
 * isolation-guard.test.ts (bun, against an oh-my-pi checkout — see the
 * test header).
 */

import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

/** `t` + 9-hex digest — omp's task-isolation directory segment. */
const ISOLATION_SEGMENT = /^t[0-9a-f]{9}$/;
const ISOLATION_MOUNT = "m";

/** Verdict for a single tool call: block with reason, or let it run. */
export interface GuardVerdict {
	block: true;
	reason: string;
}

/**
 * Locate the isolation snapshot root (`…/t<hex9>/m`) containing `cwd`.
 * Returns undefined for ordinary (non-isolated) sessions.
 */
export function findIsolationRoot(cwd: string): string | undefined {
	const segments = path.resolve(cwd).split(path.sep);
	for (let i = 0; i + 1 < segments.length; i++) {
		if (ISOLATION_SEGMENT.test(segments[i]) && segments[i + 1] === ISOLATION_MOUNT) {
			return segments.slice(0, i + 2).join(path.sep) || path.sep;
		}
	}
	return undefined;
}

function expandHome(p: string): string {
	if (p === "~") return os.homedir();
	if (p.startsWith(`~${path.sep}`) || p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
	return p;
}

/**
 * Classify one path-like tool argument against the snapshot root.
 * Relative paths resolve against the root (the session cwd) and pass by
 * construction; absolute paths must stay inside the root or scratch
 * space (OS tempdir, /tmp, /var/tmp, /dev). Internal-URL targets
 * (`local://`, `skill://`, `xd://`, …) are not filesystem escapes.
 */
function offendingPath(raw: string, root: string): string | undefined {
	const candidate = expandHome(raw.trim());
	if (candidate.length === 0 || /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(candidate)) return undefined;
	if (!path.isAbsolute(candidate)) return undefined;
	const resolved = path.resolve(candidate);
	if (resolved === root || resolved.startsWith(`${root}${path.sep}`)) return undefined;
	const tmp = path.resolve(os.tmpdir());
	const isScratch =
		resolved === tmp ||
		resolved.startsWith(`${tmp}${path.sep}`) ||
		/^\/(?:var\/)?tmp(?:\/|$)/.test(resolved) ||
		resolved.startsWith("/dev/");
	return isScratch ? undefined : candidate;
}

function blockVerdict(offender: string, root: string, what: string): GuardVerdict {
	return {
		block: true,
		reason:
			`isolation-guard: ${what} ${offender} is OUTSIDE your isolated snapshot (${root}). ` +
			`This session runs in a copy-on-write snapshot of the repository; absolute paths into the ` +
			`original checkout bypass isolation and corrupt the shared tree, and such changes are NOT ` +
			`captured with your work. The snapshot contains the full repo — use the same path relative ` +
			`to your working directory. For shared artifacts use local:// URIs; for scratch files use /tmp.`,
	};
}

/** Section headers in the edit tool's hashline input: `[path#TAG]`. */
const EDIT_HEADER = /^\[(.+)#[0-9A-Fa-f]{4}\]\s*$/gm;

/** Leading `cd <dir> && …` — same shape the bash tool itself extracts into cwd. */
const LEADING_CD = /^cd[ \t]+((?:[^&\\\n\r]|\\.)+?)[ \t]*&&[ \t]*/;

/** Structural subset of the tool_call event the guard inspects. */
export interface GuardToolCallEvent {
	toolName: string;
	input?: Record<string, unknown>;
}

/**
 * Evaluate one tool call against the session cwd. Returns a blocking
 * verdict for isolation escapes, undefined to let the call run.
 */
export function evaluateToolCall(event: GuardToolCallEvent, cwd: string): GuardVerdict | undefined {
	const root = findIsolationRoot(cwd);
	if (!root) return undefined;
	const input = event.input ?? {};

	switch (event.toolName) {
		case "write": {
			const target = typeof input.path === "string" ? input.path : undefined;
			if (!target) return undefined;
			// xd://ast_edit carries its real targets in the JSON body.
			if (target.startsWith("xd://ast_edit")) {
				return checkAstEditContent(typeof input.content === "string" ? input.content : "", root);
			}
			const offender = offendingPath(target, root);
			return offender ? blockVerdict(offender, root, "write target") : undefined;
		}
		case "edit": {
			const hashline = typeof input.input === "string" ? input.input : undefined;
			if (!hashline) return undefined;
			for (const match of hashline.matchAll(EDIT_HEADER)) {
				const offender = offendingPath(match[1], root);
				if (offender) return blockVerdict(offender, root, "edit target");
			}
			return undefined;
		}
		case "bash": {
			const rawCwd = typeof input.cwd === "string" ? input.cwd : undefined;
			if (rawCwd) {
				const offender = offendingPath(rawCwd, root);
				if (offender) return blockVerdict(offender, root, "bash cwd");
			}
			const command = typeof input.command === "string" ? input.command : "";
			const cdMatch = command.match(LEADING_CD);
			// Skip paths needing shell expansion — mirrors the bash tool's extraction guard.
			if (cdMatch && !/[$`(]/.test(cdMatch[1])) {
				const target = cdMatch[1].trim().replace(/^["']|["']$/g, "");
				const offender = offendingPath(target, root);
				if (offender) return blockVerdict(offender, root, "bash cwd (leading cd)");
			}
			return undefined;
		}
		default:
			return undefined;
	}
}

/** Check the `paths` array of an ast_edit JSON payload. Fail-open on malformed JSON. */
function checkAstEditContent(content: string, root: string): GuardVerdict | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch {
		return undefined; // the tool itself rejects malformed args
	}
	if (parsed === null || typeof parsed !== "object" || !("paths" in parsed)) return undefined;
	const paths = parsed.paths;
	if (!Array.isArray(paths)) return undefined;
	for (const entry of paths) {
		if (typeof entry !== "string") continue;
		const offender = offendingPath(entry, root);
		if (offender) return blockVerdict(offender, root, "ast_edit path");
	}
	return undefined;
}

/** Structural subset of ExtensionAPI/context, for tests. */
export interface GuardPi {
	on(event: "tool_call", handler: (event: GuardToolCallEvent, ctx: { cwd: string }) => GuardVerdict | undefined): void;
}

export function createIsolationGuard(pi: GuardPi): void {
	pi.on("tool_call", (event, ctx) => evaluateToolCall(event, ctx.cwd));
}

export default function (pi: ExtensionAPI) {
	createIsolationGuard(pi as unknown as GuardPi);
}
