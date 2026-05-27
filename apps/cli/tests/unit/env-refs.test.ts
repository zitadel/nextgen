import { describe, expect, it } from "vitest";

import { findEnvRefs } from "../../src/commands/apply";

describe("findEnvRefs", () => {
  it("detects ${VAR} placeholders inside strings", () => {
    expect(findEnvRefs({ url: "${ZITADEL_API_BASE}/foo" })).toEqual(["ZITADEL_API_BASE"]);
  });

  it("detects *_env convention keys on nested resources", () => {
    const resource = {
      version: 1,
      kind: "app",
      slug: "demo",
      protocol: "oidc",
      oidc: {
        client_id: "demo.apps.googleusercontent.com",
        client_secret_env: "ZITADEL_APP_DEMO_SECRET",
      },
    };
    expect(findEnvRefs(resource)).toEqual(["ZITADEL_APP_DEMO_SECRET"]);
  });

  it("merges both conventions and deduplicates", () => {
    const bundle = {
      ".zitadel/apps/web.json": {
        oidc: { client_secret_env: "WEB_SECRET" },
      },
      ".zitadel/apps/api.json": {
        oidc: { issuer: "${API_ISSUER}", client_secret_env: "API_SECRET" },
      },
      server: "${ZITADEL_API_BASE}",
    };
    expect(findEnvRefs(bundle)).toEqual([
      "API_ISSUER",
      "API_SECRET",
      "WEB_SECRET",
      "ZITADEL_API_BASE",
    ]);
  });

  it("ignores *_env keys whose value is not a plain env var name", () => {
    const resource = { oidc: { client_secret_env: "not a var name" } };
    expect(findEnvRefs(resource)).toEqual([]);
  });
});
