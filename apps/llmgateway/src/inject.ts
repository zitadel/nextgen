import type { TextBlockParam } from "@anthropic-ai/sdk/resources/messages";

import { ZITADEL_SYSTEM_PROMPT } from "./system-prompt.js";

/**
 * Exact string Anthropic requires as the first system block when a request
 * is authenticated with an OAuth (claude.ai / Claude Max) bearer token.
 * Requests without this prefix return a fast `429 rate_limit_error`
 * regardless of actual usage. Matches the official `claude` CLI byte-for-
 * byte; the gateway mirrors it in OAuth mode.
 */
export const CLAUDE_CODE_IDENTIFIER_TEXT =
	"You are Claude Code, Anthropic's official CLI for Claude.";

const CLAUDE_CODE_IDENTIFIER_BLOCK: TextBlockParam = {
	type: "text",
	text: CLAUDE_CODE_IDENTIFIER_TEXT,
};

/**
 * Resolve the active guardrail text.
 *
 * The `ZITADEL_SYSTEM_PROMPT` environment variable takes precedence —
 * allowing the guardrail to be rotated without a code redeploy. Falls back
 * to the compiled-in {@link ZITADEL_SYSTEM_PROMPT} default when the variable
 * is unset, empty, or whitespace-only.
 */
export function resolveGuardrailText(env: NodeJS.ProcessEnv = process.env): string {
	const fromEnv = env["ZITADEL_SYSTEM_PROMPT"];
	if (fromEnv !== undefined && fromEnv.trim().length > 0) {
		return fromEnv;
	}
	return ZITADEL_SYSTEM_PROMPT;
}

function normaliseSystem(value: unknown): ReadonlyArray<TextBlockParam> {
	if (typeof value === "string") {
		return [{ type: "text", text: value }];
	}
	if (Array.isArray(value)) {
		// Accept only plain text blocks; silently drop image / tool_use / etc.
		// Also strip any caller-supplied cache_control: the Messages API caps
		// cache markers at 4 per request and the SDK reserves them for its own
		// blocks, so a leaked marker from the client could push the request
		// over the limit and break caching on every subsequent block.
		return (value as unknown[])
			.filter(
				(item): item is Record<string, unknown> =>
					typeof item === "object" &&
					item !== null &&
					(item as Record<string, unknown>)["type"] === "text" &&
					typeof (item as Record<string, unknown>)["text"] === "string",
			)
			.map((item) => ({ type: "text" as const, text: item["text"] as string }));
	}
	return [];
}

/**
 * Return a new request body with the ZITADEL guardrail (and, in OAuth mode,
 * the Claude Code identifier) prepended to the `system` field.
 *
 * Invariants:
 *
 * - The input body is not mutated.
 * - The returned `system` is always an array of `TextBlockParam`.
 * - In OAuth mode the identifier block is first; the guardrail follows;
 *   caller-supplied blocks come last.
 * - No `cache_control` is attached to the prepended blocks — the Messages
 *   API caps cache markers at 4 per request and the upstream SDK may
 *   already be using them.
 */
export function injectSystemPrompt(
	body: Record<string, unknown>,
	options: { readonly prependClaudeCodeIdentifier: boolean; readonly guardrailText?: string },
): Record<string, unknown> {
	const guardrailBlock: TextBlockParam = {
		type: "text",
		text: options.guardrailText ?? resolveGuardrailText(),
	};
	const prefix: ReadonlyArray<TextBlockParam> = options.prependClaudeCodeIdentifier
		? [CLAUDE_CODE_IDENTIFIER_BLOCK, guardrailBlock]
		: [guardrailBlock];

	return {
		...body,
		system: [...prefix, ...normaliseSystem(body["system"])],
	};
}
