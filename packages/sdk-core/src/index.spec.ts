import { describe, expect, it } from "vitest";

import { resolveZitadelRuntime, resolveZitadelRuntimeEnv } from "./index.js";

describe("resolveZitadelRuntimeEnv", () => {
  it("uses public project metadata", () => {
    const runtime = resolveZitadelRuntimeEnv({
      ZITADEL_PROJECT_ID: "proj_123",
      ZITADEL_ISSUER: "http://localhost:3000",
    });

    expect(runtime).toEqual({
      projectId: "proj_123",
      issuer: "http://localhost:3000",
    });
  });

  it("prefers NEXT_PUBLIC values for browser runtimes", () => {
    const runtime = resolveZitadelRuntimeEnv({
      ZITADEL_PROJECT_ID: "server-side",
      NEXT_PUBLIC_ZITADEL_PROJECT_ID: "browser-safe",
      ZITADEL_RELEASE: "rel_server",
      NEXT_PUBLIC_ZITADEL_RELEASE: "sha256:9f2c1a7b4e83",
    });

    expect(runtime).toEqual({
      projectId: "browser-safe",
      release: "sha256:9f2c1a7b4e83",
    });
    expect("secret" in runtime).toBe(false);
  });

  it("carries the release a build pins when the env names one", () => {
    expect(resolveZitadelRuntime({ projectId: "proj_123", release: "rel_01" })).toEqual({
      projectId: "proj_123",
      release: "rel_01",
    });
    expect(resolveZitadelRuntime({ projectId: "proj_123" })).toEqual({ projectId: "proj_123" });
  });

  it("requires project metadata without accepting browser secrets", () => {
    expect(() =>
      resolveZitadelRuntimeEnv({
        ZITADEL_PREVIEW_SECRET: "sk_proj_preview",
      }),
    ).toThrow("ZITADEL_PROJECT_ID");
  });
});
