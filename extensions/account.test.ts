/**
 * account extension tests. Run from an oh-my-pi checkout so the
 * @oh-my-pi/* workspace packages resolve (extensions/node_modules symlink):
 *   nix shell nixpkgs#bun -c bun test path/to/afk/extensions/account.test.ts
 */
import { describe, expect, it } from "bun:test";
import { loadExtensions } from "@oh-my-pi/pi-coding-agent/extensibility/extensions";
import {
	type AccountDeps,
	type AccountRow,
	handleAccount,
	resolveAccountChoice,
} from "./account";

const ACCOUNTS: AccountRow[] = [
	{ position: 0, credentialId: 1, email: "alice@example.com", active: true },
	{ position: 1, credentialId: 2, email: "bob@example.com", active: false },
	{ position: 2, credentialId: 3, email: "bob@corp.example.com", orgName: "Corp", active: false },
];

type TestDeps = AccountDeps & { notifications: Array<[string, string | undefined]> };

function makeDeps(overrides: { pick?: string; accounts?: AccountRow[] } = {}): TestDeps {
	const deps: TestDeps = {
		notifications: [],
		provider: "anthropic",
		sessionId: "session-1",
		authStorage: {
			reload: async () => {},
			listOAuthAccounts: () => overrides.accounts ?? ACCOUNTS,
			pinSessionCredential: (_provider: string, _sessionId: string, credentialId: number) => ({
				email: (overrides.accounts ?? ACCOUNTS).find(account => account.credentialId === credentialId)?.email,
			}),
		},
		select: async (_title: string, _options: Array<string | { label: string; description?: string }>) => overrides.pick,
		notify: (message: string, type?: "info" | "warning" | "error") => {
			deps.notifications.push([message, type]);
		},
	};
	return deps;
}

/** Replace the pin spy, recording every pinned credentialId into `pinned`. */
function spyPins(deps: TestDeps, pinned: number[]): void {
	deps.authStorage.pinSessionCredential = (_provider: string, _sessionId: string, credentialId: number) => {
		pinned.push(credentialId);
		return { email: ACCOUNTS.find(account => account.credentialId === credentialId)?.email };
	};
}

describe("resolveAccountChoice", () => {
	it("resolves a 1-based position", () => {
		expect(resolveAccountChoice(ACCOUNTS, "2").account?.credentialId).toBe(2);
	});

	it("rejects out-of-range positions", () => {
		const result = resolveAccountChoice(ACCOUNTS, "4");
		expect(result.account).toBeUndefined();
		expect(result.error).toContain("1-3");
	});

	it("resolves an exact email match ahead of substring hits", () => {
		expect(resolveAccountChoice(ACCOUNTS, "bob@example.com").account?.credentialId).toBe(2);
	});

	it("resolves a unique case-insensitive substring", () => {
		expect(resolveAccountChoice(ACCOUNTS, "ALICE").account?.credentialId).toBe(1);
	});

	it("resolves a unique org-name substring", () => {
		expect(resolveAccountChoice(ACCOUNTS, "corp").account?.credentialId).toBe(3);
	});

	it("reports ambiguous substrings instead of guessing", () => {
		const result = resolveAccountChoice(ACCOUNTS, "bob");
		expect(result.account).toBeUndefined();
		expect(result.error).toContain("bob@example.com");
		expect(result.error).toContain("bob@corp.example.com");
	});

	it("reports unknown queries", () => {
		const result = resolveAccountChoice(ACCOUNTS, "nobody");
		expect(result.account).toBeUndefined();
		expect(result.error).toBeDefined();
	});
});

describe("handleAccount", () => {
	it("pins a query-named account without opening the picker", async () => {
		const pinned: number[] = [];
		const deps = makeDeps();
		spyPins(deps, pinned);
		deps.select = async () => {
			throw new Error("picker must not open when a query pins directly");
		};
		await handleAccount("alice", deps);
		expect(pinned).toEqual([1]);
		expect(deps.notifications.some(([message]) => message.includes("alice@example.com"))).toBe(true);
	});

	it("pins an exact-email query and reports the identity", async () => {
		const pinned: number[] = [];
		const deps = makeDeps();
		spyPins(deps, pinned);
		await handleAccount("bob@example.com", deps);
		expect(pinned).toEqual([2]);
		expect(deps.notifications.some(([message]) => message.includes("bob@example.com"))).toBe(true);
	});

	it("surfaces matcher errors as notifications", async () => {
		const deps = makeDeps();
		await handleAccount("bob", deps);
		expect(deps.notifications.at(-1)?.[1]).toBe("error");
		expect(deps.notifications.at(-1)?.[0]).toContain("ambiguous");
	});

	it("reports providers without stored accounts", async () => {
		const deps = makeDeps({ accounts: [] });
		await handleAccount("", deps);
		expect(deps.notifications.at(-1)?.[0]).toContain("No stored OAuth accounts");
	});

	it("opens the picker without a query and pins the selection", async () => {
		const pickedLabels: string[] = [];
		const deps = makeDeps();
		deps.select = async (_title, options) => {
			pickedLabels.push(...options.map(option => (typeof option === "string" ? option : option.label)));
			return "bob@example.com";
		};
		const pinned: number[] = [];
		spyPins(deps, pinned);
		await handleAccount("", deps);
		// The active account is rendered with the marker so the user sees
		// which account the session is currently on.
		expect(pickedLabels).toContain("alice@example.com (active)");
		expect(pickedLabels).toContain("bob@example.com");
		expect(pinned).toEqual([2]);
	});

	it("pins the active account selected with its marker label", async () => {
		const deps = makeDeps();
		deps.select = async () => "alice@example.com (active)";
		const pinned: number[] = [];
		spyPins(deps, pinned);
		await handleAccount("", deps);
		expect(pinned).toEqual([1]);
	});

	it("silently cancels when the picker is dismissed", async () => {
		const deps = makeDeps({ pick: undefined });
		await handleAccount("", deps);
		expect(deps.notifications).toEqual([]);
	});

	it("errors without an active model", async () => {
		const deps = makeDeps();
		deps.provider = undefined;
		await handleAccount("", deps);
		expect(deps.notifications.at(-1)?.[1]).toBe("error");
	});
});

describe("extension loading", () => {
	it("loads under omp's real extension loader without errors", async () => {
		const result = await loadExtensions([`${import.meta.dir}/account.ts`], "/tmp");
		expect(result.errors).toEqual([]);
		expect(result.extensions).toHaveLength(1);
	});
});
