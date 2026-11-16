import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_URL, resolveProjectSecret, resolveUrl } from "../../runtime/lib/settings";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveUrl", () => {
  it("prefers the runtime config over ZITADEL_URL", () => {
    vi.stubEnv("ZITADEL_URL", "http://env.test");

    expect(resolveUrl({ url: "http://config.test" })).toBe("http://config.test");
  });

  it("reads ZITADEL_URL from the server's environment when the runtime config has none", () => {
    vi.stubEnv("ZITADEL_URL", "http://env.test");

    expect(resolveUrl({ url: "" })).toBe("http://env.test");
  });

  it("falls back to the local server", () => {
    vi.stubEnv("ZITADEL_URL", "");

    expect(resolveUrl(undefined)).toBe(DEFAULT_URL);
  });
});

describe("resolveProjectSecret", () => {
  it("prefers the runtime config over ZITADEL_PROJECT_SECRET", () => {
    vi.stubEnv("ZITADEL_PROJECT_SECRET", "sk_env");

    expect(resolveProjectSecret({ projectSecret: "sk_config" })).toBe("sk_config");
  });

  it("reads ZITADEL_PROJECT_SECRET from the server's environment when the runtime config has none", () => {
    vi.stubEnv("ZITADEL_PROJECT_SECRET", "sk_env");

    expect(resolveProjectSecret({ projectSecret: "" })).toBe("sk_env");
  });

  it("is undefined when neither is set", () => {
    vi.stubEnv("ZITADEL_PROJECT_SECRET", "");

    expect(resolveProjectSecret({ projectSecret: "" })).toBeUndefined();
  });
});
