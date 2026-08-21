/**
 * account — afk distribution's `/account` slash command.
 *
 * With several Claude subscriptions Anthropic routes each session to one
 * stored OAuth account (session-sticky, usage-ranked). The status line shows
 * which one (see omp-statusline-anthropic-account.patch); this command lets
 * the user choose it instead:
 *
 *   /account            — picker over the stored accounts (active marked)
 *   /account <email|substring|1-based #> — pin directly
 *
 * The pin goes through AuthStorage.pinSessionCredential (added by
 * omp-anthropic-weekly-reset-priority.patch): the same session-sticky
 * preference a successful getApiKey would record (30-day TTL, survives
 * session resume), plus a clear of the credential's rate-limit blocks so
 * the pinned account is actually tried on the next request.
 */

import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

/** Structural view of OAuthAccountSummary — only the fields this command uses. */
export interface AccountRow {
	position: number;
	credentialId: number;
	email?: string;
	orgName?: string;
	active: boolean;
}

export interface AccountChoiceResult {
	account?: AccountRow;
	error?: string;
}

/**
 * Resolve a `/account <query>` argument against the stored accounts: a
 * 1-based position as rendered by the picker, an exact email match, or a
 * unique case-insensitive substring of email/org name. Ambiguity is an error
 * naming the candidates — never a guess.
 */
export function resolveAccountChoice(accounts: AccountRow[], query: string): AccountChoiceResult {
	const trimmed = query.trim();
	if (trimmed.length === 0) return { error: "Empty account query." };

	if (/^\d+$/.test(trimmed)) {
		const position = Number.parseInt(trimmed, 10);
		const account = accounts[position - 1];
		if (!account) return { error: `No account #${position}; valid positions are 1-${accounts.length}.` };
		return { account };
	}

	const lowered = trimmed.toLowerCase();
	const exact = accounts.filter(account => (account.email ?? "").toLowerCase() === lowered);
	if (exact.length === 1) return { account: exact[0] };

	const matches = accounts.filter(account => {
		if ((account.email ?? "").toLowerCase().includes(lowered)) return true;
		return account.orgName?.toLowerCase().includes(lowered) ?? false;
	});
	if (matches.length === 1) return { account: matches[0] };
	if (matches.length > 1) {
		return { error: `"${trimmed}" is ambiguous: ${matches.map(account => account.email ?? `#${account.credentialId}`).join(", ")}.` };
	}
	return { error: `No stored account matches "${trimmed}".` };
}

/** Display label for one account in the picker and in error messages. */
export function accountLabel(account: AccountRow): string {
	return account.email ?? `account #${account.position + 1}`;
}

/** Minimal auth-storage surface the command drives (structural, for tests). */
export interface AccountAuthStorage {
	reload(): Promise<void>;
	listOAuthAccounts(provider: string, sessionId?: string): AccountRow[];
	pinSessionCredential(
		provider: string,
		sessionId: string,
		credentialId: number,
	): { email?: string } | undefined;
}

/** Everything the handler needs, assembled from ExtensionCommandContext. */
export interface AccountDeps {
	provider?: string;
	sessionId?: string;
	authStorage: AccountAuthStorage;
	select(title: string, options: Array<string | { label: string; description?: string }>): Promise<string | undefined>;
	notify(message: string, type?: "info" | "warning" | "error"): void;
}

/**
 * `/account` body: with a query, pin the resolved account directly; without
 * one, show the picker and pin the selection. Cancellation is silent.
 */
export async function handleAccount(query: string, deps: AccountDeps): Promise<void> {
	const { provider, sessionId, authStorage } = deps;
	if (!provider) {
		deps.notify("No active model; cannot determine which provider's account to switch.", "error");
		return;
	}
	if (!sessionId) {
		deps.notify("No active session; cannot pin an account.", "error");
		return;
	}
	try {
		await authStorage.reload();
	} catch (error: unknown) {
		deps.notify(`Could not load stored credentials: ${error instanceof Error ? error.message : String(error)}`, "error");
		return;
	}
	const accounts = authStorage.listOAuthAccounts(provider, sessionId);
	if (accounts.length === 0) {
		deps.notify(`No stored OAuth accounts for ${provider}; use /login to add one.`, "error");
		return;
	}

	const pin = (account: AccountRow): void => {
		const identity = authStorage.pinSessionCredential(provider, sessionId, account.credentialId);
		if (identity) {
			deps.notify(`Session now using ${identity.email ?? accountLabel(account)} for ${provider}.`);
		} else {
			deps.notify(`Could not pin ${accountLabel(account)}; the credential may have been removed.`, "error");
		}
	};

	if (query !== undefined && query.trim().length > 0) {
		const choice = resolveAccountChoice(accounts, query);
		if (!choice.account) {
			deps.notify(choice.error ?? `No stored account matches "${query}".`, "error");
			return;
		}
		pin(choice.account);
		return;
	}

	const options = accounts.map(account => ({
		label: account.active ? `${accountLabel(account)} (active)` : accountLabel(account),
		...(account.orgName ? { description: account.orgName } : {}),
	}));
	const selected = await deps.select(`Select ${provider} account for this session:`, options);
	if (selected === undefined) return;
	const account = accounts.find(candidate => (candidate.active ? `${accountLabel(candidate)} (active)` : accountLabel(candidate)) === selected);
	if (!account) return;
	pin(account);
}

export function createAccountExtension(pi: AccountPi): void {
	pi.registerCommand("account", {
		description: "Switch the OAuth account used by this session",
		handler: async (args, ctx) => {
			const commandCtx = ctx as unknown as {
				model: { provider: string } | undefined;
				modelRegistry: { authStorage: AccountAuthStorage };
				sessionManager: { getSessionId(): string };
				ui: {
					select(title: string, options: Array<string | { label: string; description?: string }>): Promise<string | undefined>;
					notify(message: string, type?: "info" | "warning" | "error"): void;
				};
			};
			await handleAccount(args, {
				provider: commandCtx.model?.provider,
				sessionId: commandCtx.sessionManager?.getSessionId(),
				authStorage: commandCtx.modelRegistry.authStorage,
				select: (title, options) => commandCtx.ui.select(title, options),
				notify: (message, type) => commandCtx.ui.notify(message, type),
			});
		},
	});
}

export default function (pi: ExtensionAPI) {
	createAccountExtension(pi as unknown as AccountPi);
}
