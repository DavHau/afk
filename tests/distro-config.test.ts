/**
 * Distribution settings layer — end-to-end against the built `afk` wrapper.
 *
 * The whole Superpowers library reaches the agent through exactly one path:
 * $OMP_DISTRO_CONFIG (the omp-distro-default-settings patch) carries
 * `skills.customDirectories`, which points at the afk-skills store output.
 * If that layer silently degrades to {}, the harness starts with zero
 * skills and nothing anywhere reports an error — the omp 17.2.1 rebase did
 * exactly that (`#loadYamlIfPresent` started returning a tagged
 * YamlLoadResult instead of RawSettings, so `#distro` became
 * `{kind, settings}` and merged as junk keys).
 *
 * These tests run the real wrapper, so they cover the patch, the generated
 * config.yml, and the wrapper env in one shot. `nix build` is cache-warm
 * after the first run.
 */
import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const afkBin = (() => {
	const built = Bun.spawnSync(["nix", "build", "--no-link", "--print-out-paths", ".#afk"], {
		cwd: join(import.meta.dir, ".."),
	});
	if (built.exitCode !== 0) throw new Error(`nix build .#afk failed: ${built.stderr.toString()}`);
	return join(built.stdout.toString().trim().split("\n").at(-1)!, "bin", "afk");
})();

/** Run `afk config get <key>` in a throwaway HOME + cwd. */
function configGet(key: string, opts: { userConfig?: string } = {}): string {
	const root = mkdtempSync(join(tmpdir(), "afk-distro-"));
	const agentDir = join(root, "home", ".omp", "profiles", "afk", "agent");
	Bun.spawnSync(["mkdir", "-p", agentDir]);
	if (opts.userConfig !== undefined) writeFileSync(join(agentDir, "config.yml"), opts.userConfig);
	const run = Bun.spawnSync([afkBin, "config", "get", key], {
		cwd: root,
		env: { ...process.env, HOME: join(root, "home") },
	});
	return run.stdout.toString().trim();
}

describe("distribution settings layer", () => {
	it("applies distro defaults the user has not overridden", () => {
		expect(configGet("startup.quiet")).toBe("true");
	});

	it("exposes the afk-skills root as a custom skills directory", () => {
		const dirs = JSON.parse(configGet("skills.customDirectories")) as string[];
		expect(dirs.length).toBeGreaterThan(0);
		const superpowers = dirs.find(dir => dir.includes("afk-skills"));
		expect(superpowers).toBeDefined();
		// Discovery is non-recursive: <root>/<name>/SKILL.md must exist.
		expect(existsSync(join(superpowers!, "using-superpowers", "SKILL.md"))).toBe(true);
		expect(existsSync(join(superpowers!, "brainstorming", "SKILL.md"))).toBe(true);
	});

	it("lets the user's own config.yml win over the distro layer", () => {
		expect(configGet("startup.quiet", { userConfig: "startup:\n  quiet: false\n" })).toBe("false");
	});
});
