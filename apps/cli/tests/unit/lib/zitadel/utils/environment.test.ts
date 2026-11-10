import { describe, expect, it } from "vitest";

import { environmentReferences } from "@/lib/zitadel/utils/environment";

describe("environmentReferences", () => {
  it("detects ${VAR} placeholders inside strings", () => {
    const resource = { url: "${ZITADEL_API_BASE}/foo" };

    const names = environmentReferences(resource);

    expect(names).toEqual(["ZITADEL_API_BASE"]);
  });

  it("detects *_env convention keys on nested objects", () => {
    const resource = {
      version: 1,
      name: "default",
      config: { token: "abc", secret_env: "ZITADEL_DEMO_SECRET" },
    };

    const names = environmentReferences(resource);

    expect(names).toEqual(["ZITADEL_DEMO_SECRET"]);
  });

  it("merges both conventions and deduplicates", () => {
    const bundle = {
      ".zitadel/flows/login.json": { gate: { secret_env: "CAPTCHA_SECRET" } },
      ".zitadel/flows/register.json": {
        gate: { issuer: "${GATE_ISSUER}", secret_env: "GATE_SECRET" },
      },
      server: "${ZITADEL_API_BASE}",
    };

    const names = environmentReferences(bundle);

    expect(names).toEqual(["CAPTCHA_SECRET", "GATE_ISSUER", "GATE_SECRET", "ZITADEL_API_BASE"]);
  });

  it("ignores *_env keys whose value is not a plain env var name", () => {
    const resource = { gate: { secret_env: "not a var name" } };

    const names = environmentReferences(resource);

    expect(names).toEqual([]);
  });
});
