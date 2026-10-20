import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_BACKEND_URL } from "@zitadel/sdk-core/middleware";

import { resolveProjectSecret, resolveUrl } from "../../runtime/lib/settings";

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

    expect(resolveUrl(undefined)).toBe(DEFAULT_BACKEND_URL);
  });

  it("prefers the runtime config url over its issuerUrl", () => {
    vi.stubEnv("ZITADEL_URL", "http://env.test");

    expect(resolveUrl({ url: "http://config.test", issuerUrl: "http://issuer.test" })).toBe(
      "http://config.test",
    );
  });

  it("reads the runtime config issuerUrl before ZITADEL_URL", () => {
    vi.stubEnv("ZITADEL_URL", "http://env.test");

    expect(resolveUrl({ url: "", issuerUrl: "http://issuer.test/" })).toBe("http://issuer.test");
  });

  it.each([" \t", "/", " / ", "//"])("treats a runtime config of %j as unset", (blank) => {
    vi.stubEnv("ZITADEL_URL", "http://env.test");

    expect(resolveUrl({ url: blank, issuerUrl: blank })).toBe("http://env.test");
  });

  it("ignores a runtime config value that is not a string", () => {
    vi.stubEnv("ZITADEL_URL", "http://env.test");

    expect(resolveUrl({ url: 8080, issuerUrl: ["http://issuer.test"] })).toBe("http://env.test");
  });

  it("falls back to the local server when every source is blank", () => {
    vi.stubEnv("ZITADEL_URL", " ");

    expect(resolveUrl({ url: " " })).toBe(DEFAULT_BACKEND_URL);
  });

  it("strips the trailing slash of the url it resolves", () => {
    vi.stubEnv("ZITADEL_URL", "http://env.test/");

    expect(resolveUrl(undefined)).toBe("http://env.test");
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
