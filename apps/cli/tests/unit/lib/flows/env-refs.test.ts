import { describe, expect, it } from "vitest";

import { flowEnvRefs } from "../../../../src/lib/flows";

describe("flowEnvRefs", () => {
  it("detects ${VAR} placeholders inside strings", () => {
    expect(flowEnvRefs({ url: "${ZITADEL_API_BASE}/foo" })).toEqual(["ZITADEL_API_BASE"]);
  });

  it("detects *_env convention keys on nested objects", () => {
    const resource = {
      version: 1,
      name: "default",
      config: {
        token: "abc",
        secret_env: "ZITADEL_DEMO_SECRET",
      },
    };
    expect(flowEnvRefs(resource)).toEqual(["ZITADEL_DEMO_SECRET"]);
  });

  it("merges both conventions and deduplicates", () => {
    const bundle = {
      ".zitadel/flows/login.json": {
        gate: { secret_env: "CAPTCHA_SECRET" },
      },
      ".zitadel/flows/register.json": {
        gate: { issuer: "${GATE_ISSUER}", secret_env: "GATE_SECRET" },
      },
      server: "${ZITADEL_API_BASE}",
    };
    expect(flowEnvRefs(bundle)).toEqual([
      "CAPTCHA_SECRET",
      "GATE_ISSUER",
      "GATE_SECRET",
      "ZITADEL_API_BASE",
    ]);
  });

  it("ignores *_env keys whose value is not a plain env var name", () => {
    const resource = { gate: { secret_env: "not a var name" } };
    expect(flowEnvRefs(resource)).toEqual([]);
  });
});
