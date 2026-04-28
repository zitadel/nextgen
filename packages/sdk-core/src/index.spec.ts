import { describe, expect, it } from "vitest";

import { resolveZitadelRuntime, resolveZitadelRuntimeEnv } from "./index.js";

describe("resolveZitadelRuntimeEnv", () => {
  it("uses public project metadata in development", () => {
    const runtime = resolveZitadelRuntimeEnv({
      ZITADEL_PROJECT_ID: "proj_123",
      ZITADEL_ENVIRONMENT: "development",
      ZITADEL_ISSUER: "http://localhost:3000",
    });

    expect(runtime).toEqual({
      projectId: "proj_123",
      environment: "development",
      issuer: "http://localhost:3000",
    });
  });

  it("prefers NEXT_PUBLIC values for browser runtimes", () => {
    const runtime = resolveZitadelRuntimeEnv({
      ZITADEL_PROJECT_ID: "server-side",
      NEXT_PUBLIC_ZITADEL_PROJECT_ID: "browser-safe",
      NEXT_PUBLIC_ZITADEL_ENVIRONMENT: "preview",
      NEXT_PUBLIC_ZITADEL_ISSUER: "https://preview.example",
    });

    expect(runtime).toEqual({
      projectId: "browser-safe",
      environment: "preview",
      issuer: "https://preview.example",
    });
    expect("secret" in runtime).toBe(false);
  });

  it("requires an issuer for production", () => {
    expect(() =>
      resolveZitadelRuntime({
        projectId: "proj_123",
        environment: "production",
      }),
    ).toThrow("claim");
  });

  it("requires project metadata without accepting browser secrets", () => {
    expect(() =>
      resolveZitadelRuntimeEnv({
        NEXT_PUBLIC_ZITADEL_ENVIRONMENT: "preview",
        ZITADEL_PREVIEW_SECRET: "sk_proj_preview",
      }),
    ).toThrow("ZITADEL_PROJECT_ID");
  });
});
