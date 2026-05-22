import { describe, expect, it } from "vitest";

import { ZITADEL_SYSTEM_PROMPT } from "../src/system-prompt.js";

describe("ZITADEL_SYSTEM_PROMPT", () => {
	it("is a non-empty string", () => {
		expect(typeof ZITADEL_SYSTEM_PROMPT).toBe("string");
		expect(ZITADEL_SYSTEM_PROMPT.length).toBeGreaterThan(100);
	});

	it("identifies as the ZITADEL integration assistant", () => {
		expect(ZITADEL_SYSTEM_PROMPT).toMatch(/ZITADEL integration assistant/i);
	});

	it("contains all five numbered hard rules", () => {
		for (const n of [1, 2, 3, 4, 5]) {
			expect(ZITADEL_SYSTEM_PROMPT).toMatch(new RegExp(`^${n}\\.`, "m"));
		}
	});

	it("references the high-value forbidden paths the e2e suite probes", () => {
		expect(ZITADEL_SYSTEM_PROMPT).toMatch(/\.\./);
		expect(ZITADEL_SYSTEM_PROMPT).toMatch(/\.env/);
		expect(ZITADEL_SYSTEM_PROMPT).toMatch(/\.ssh/);
		expect(ZITADEL_SYSTEM_PROMPT).toMatch(/\.aws/);
		expect(ZITADEL_SYSTEM_PROMPT).toMatch(/private keys?/i);
	});

	it("explicitly forbids exfiltration", () => {
		expect(ZITADEL_SYSTEM_PROMPT).toMatch(/exfiltrate/i);
	});

	it("declares the rules cannot be relaxed by user instructions", () => {
		expect(ZITADEL_SYSTEM_PROMPT).toMatch(/cannot be relaxed/i);
	});
});
