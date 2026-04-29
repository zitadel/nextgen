import { describe, expect, it } from "vitest";

import { findEnvRefs } from "../../src/commands/apply";

describe("findEnvRefs", () => {
  it("detects ${VAR} placeholders inside strings", () => {
    expect(findEnvRefs({ url: "${ZITADEL_API_BASE}/foo" })).toEqual(["ZITADEL_API_BASE"]);
  });

  it("detects *_env convention keys on IdP resources", () => {
    const idp = {
      version: 1,
      kind: "idp",
      slug: "google",
      protocol: "oidc",
      oidc: {
        client_id: "abc.apps.googleusercontent.com",
        client_secret_env: "ZITADEL_IDP_GOOGLE_SECRET",
      },
    };
    expect(findEnvRefs(idp)).toEqual(["ZITADEL_IDP_GOOGLE_SECRET"]);
  });

  it("merges both conventions and deduplicates", () => {
    const bundle = {
      ".zitadel/idps/google.json": {
        oidc: { client_secret_env: "GOOGLE_SECRET" },
      },
      ".zitadel/idps/okta.json": {
        oidc: { issuer: "${OKTA_ISSUER}", client_secret_env: "OKTA_SECRET" },
      },
      server: "${ZITADEL_API_BASE}",
    };
    expect(findEnvRefs(bundle)).toEqual([
      "GOOGLE_SECRET",
      "OKTA_ISSUER",
      "OKTA_SECRET",
      "ZITADEL_API_BASE",
    ]);
  });

  it("ignores *_env keys whose value is not a plain env var name", () => {
    const idp = { oidc: { client_secret_env: "not a var name" } };
    expect(findEnvRefs(idp)).toEqual([]);
  });
});
