import { describe, expect, it } from "vitest";

import { resolveZitadelRuntimeEnv } from "./index";

describe("resolveZitadelRuntimeEnv", () => {
  it("uses the project secret in development", () => {
    const runtime = resolveZitadelRuntimeEnv({
      ZITADEL_PROJECT_ID: "proj_123",
      ZITADEL_ENVIRONMENT: "development",
      ZITADEL_PROJECT_SECRET: "sk_proj_dev",
      ZITADEL_ISSUER: "http://localhost:3000",
    });

    expect(runtime.secretKind).toBe("project");
  });

  it("uses the preview secret in preview", () => {
    const runtime = resolveZitadelRuntimeEnv({
      ZITADEL_PROJECT_ID: "proj_123",
      ZITADEL_ENVIRONMENT: "preview",
      ZITADEL_PREVIEW_SECRET: "sk_proj_preview",
    });

    expect(runtime.secretKind).toBe("preview");
  });

  it("requires an issuer for production", () => {
    expect(() =>
      resolveZitadelRuntimeEnv({
        ZITADEL_PROJECT_ID: "proj_123",
        ZITADEL_ENVIRONMENT: "production",
        ZITADEL_PROJECT_SECRET: "sk_proj_prod",
      }),
    ).toThrow("claim");
  });
});
