import type { TextBlockParam } from "@anthropic-ai/sdk/resources/messages";
import { afterEach, describe, expect, it } from "vitest";

import {
	CLAUDE_CODE_IDENTIFIER_TEXT,
	injectSystemPrompt,
	resolveGuardrailText,
} from "../src/inject.js";
import { ZITADEL_SYSTEM_PROMPT } from "../src/system-prompt.js";

const GUARDRAIL_FIXTURE = "TEST-GUARDRAIL";

describe("resolveGuardrailText", () => {
	it("returns the env value when set and non-empty", () => {
		expect(resolveGuardrailText({ ZITADEL_SYSTEM_PROMPT: "from-env" })).toBe("from-env");
	});

	it("falls back to the default when the env value is missing", () => {
		expect(resolveGuardrailText({})).toBe(ZITADEL_SYSTEM_PROMPT);
	});

	it("falls back to the default when the env value is empty", () => {
		expect(resolveGuardrailText({ ZITADEL_SYSTEM_PROMPT: "" })).toBe(ZITADEL_SYSTEM_PROMPT);
	});

	it("falls back to the default when the env value is whitespace", () => {
		expect(resolveGuardrailText({ ZITADEL_SYSTEM_PROMPT: "   \n\t  " })).toBe(
			ZITADEL_SYSTEM_PROMPT,
		);
	});
});

describe("injectSystemPrompt — API-key mode", () => {
	it("prepends only the guardrail block when prependClaudeCodeIdentifier=false", () => {
		const out = injectSystemPrompt(
			{ model: "claude-sonnet-4-5", messages: [] },
			{ prependClaudeCodeIdentifier: false, guardrailText: GUARDRAIL_FIXTURE },
		);
		expect(out["system"]).toEqual([{ type: "text", text: GUARDRAIL_FIXTURE }]);
	});

	it("preserves caller-supplied system blocks after the guardrail", () => {
		const callerBlocks: ReadonlyArray<TextBlockParam> = [
			{ type: "text", text: "Caller block A" },
			{ type: "text", text: "Caller block B" },
		];
		const out = injectSystemPrompt(
			{ messages: [], system: callerBlocks },
			{ prependClaudeCodeIdentifier: false, guardrailText: GUARDRAIL_FIXTURE },
		);
		expect(out["system"]).toEqual([{ type: "text", text: GUARDRAIL_FIXTURE }, ...callerBlocks]);
	});

	it("normalises a string system field into a single block", () => {
		const out = injectSystemPrompt(
			{ messages: [], system: "Caller string system" },
			{ prependClaudeCodeIdentifier: false, guardrailText: GUARDRAIL_FIXTURE },
		);
		expect(out["system"]).toEqual([
			{ type: "text", text: GUARDRAIL_FIXTURE },
			{ type: "text", text: "Caller string system" },
		]);
	});

	it("treats absent system as an empty block array", () => {
		const out = injectSystemPrompt(
			{ messages: [] },
			{ prependClaudeCodeIdentifier: false, guardrailText: GUARDRAIL_FIXTURE },
		);
		expect(out["system"]).toEqual([{ type: "text", text: GUARDRAIL_FIXTURE }]);
	});
});

describe("injectSystemPrompt — OAuth mode", () => {
	it("prepends the Claude Code identifier as the first block", () => {
		const out = injectSystemPrompt(
			{ messages: [] },
			{ prependClaudeCodeIdentifier: true, guardrailText: GUARDRAIL_FIXTURE },
		);
		expect(out["system"]).toEqual([
			{ type: "text", text: CLAUDE_CODE_IDENTIFIER_TEXT },
			{ type: "text", text: GUARDRAIL_FIXTURE },
		]);
	});

	it("orders identifier → guardrail → caller blocks", () => {
		const callerBlocks: ReadonlyArray<TextBlockParam> = [{ type: "text", text: "Caller A" }];
		const out = injectSystemPrompt(
			{ messages: [], system: callerBlocks },
			{ prependClaudeCodeIdentifier: true, guardrailText: GUARDRAIL_FIXTURE },
		);
		expect(out["system"]).toEqual([
			{ type: "text", text: CLAUDE_CODE_IDENTIFIER_TEXT },
			{ type: "text", text: GUARDRAIL_FIXTURE },
			...callerBlocks,
		]);
	});
});

describe("injectSystemPrompt — invariants", () => {
	it("does not mutate the input body", () => {
		const input = {
			messages: [{ role: "user", content: "hello" }],
			system: "Caller-provided",
		};
		const snapshot = JSON.stringify(input);
		injectSystemPrompt(input, {
			prependClaudeCodeIdentifier: true,
			guardrailText: GUARDRAIL_FIXTURE,
		});
		expect(JSON.stringify(input)).toBe(snapshot);
	});

	it("preserves all non-system fields untouched", () => {
		const input = {
			model: "claude-sonnet-4-5",
			max_tokens: 1024,
			messages: [{ role: "user", content: "hi" }],
			temperature: 0.5,
			tools: [{ name: "my_tool" }],
		};
		const out = injectSystemPrompt(input, {
			prependClaudeCodeIdentifier: false,
			guardrailText: GUARDRAIL_FIXTURE,
		});
		expect(out["model"]).toBe("claude-sonnet-4-5");
		expect(out["max_tokens"]).toBe(1024);
		expect(out["messages"]).toEqual([{ role: "user", content: "hi" }]);
		expect(out["temperature"]).toBe(0.5);
		expect(out["tools"]).toEqual([{ name: "my_tool" }]);
	});

	it("does not attach cache_control to injected blocks", () => {
		const out = injectSystemPrompt(
			{ messages: [] },
			{ prependClaudeCodeIdentifier: true, guardrailText: GUARDRAIL_FIXTURE },
		);
		const blocks = out["system"] as ReadonlyArray<TextBlockParam>;
		for (const block of blocks) {
			expect(block.cache_control).toBeUndefined();
		}
	});

	it("strips cache_control from caller-supplied system blocks", () => {
		// A client could send cache_control markers to exhaust the 4-marker cap
		// or displace the SDK's own caching strategy. The gateway must scrub them.
		const callerBlocks = [
			{ type: "text", text: "Block A", cache_control: { type: "ephemeral" } },
			{ type: "text", text: "Block B" },
		];
		const out = injectSystemPrompt(
			{ messages: [], system: callerBlocks },
			{ prependClaudeCodeIdentifier: false, guardrailText: GUARDRAIL_FIXTURE },
		);
		const blocks = out["system"] as ReadonlyArray<TextBlockParam>;
		for (const block of blocks) {
			expect(block.cache_control).toBeUndefined();
		}
		// Text content is preserved
		expect(blocks.map((b) => b.text)).toContain("Block A");
		expect(blocks.map((b) => b.text)).toContain("Block B");
	});

	it("silently drops non-text caller system blocks (image, tool_use, etc.)", () => {
		// Only text blocks are forwarded upstream; other types are dropped to
		// prevent malformed requests and unvalidated content reaching Anthropic.
		const callerBlocks = [
			{ type: "text", text: "Keep me" },
			{ type: "image", source: { type: "base64", media_type: "image/png", data: "abc" } },
			{ type: "tool_use", id: "tu1", name: "bash", input: {} },
		];
		const out = injectSystemPrompt(
			{ messages: [], system: callerBlocks },
			{ prependClaudeCodeIdentifier: false, guardrailText: GUARDRAIL_FIXTURE },
		);
		const blocks = out["system"] as ReadonlyArray<TextBlockParam>;
		// Only text blocks remain (guardrail + "Keep me")
		expect(blocks.every((b) => b.type === "text")).toBe(true);
		expect(blocks.map((b) => b.text)).toContain("Keep me");
		expect(blocks).toHaveLength(2); // guardrail + caller text
	});
});

describe("injectSystemPrompt — env fallback", () => {
	const originalEnv = process.env["ZITADEL_SYSTEM_PROMPT"];

	afterEach(() => {
		if (originalEnv === undefined) {
			delete process.env["ZITADEL_SYSTEM_PROMPT"];
		} else {
			process.env["ZITADEL_SYSTEM_PROMPT"] = originalEnv;
		}
	});

	it("uses ZITADEL_SYSTEM_PROMPT from env when no explicit guardrailText is passed", () => {
		process.env["ZITADEL_SYSTEM_PROMPT"] = "env-driven-guardrail";
		const out = injectSystemPrompt({ messages: [] }, { prependClaudeCodeIdentifier: false });
		expect(out["system"]).toEqual([{ type: "text", text: "env-driven-guardrail" }]);
	});
});
