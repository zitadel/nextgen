import { describe, expect, it } from "vitest";

import { legacyConfigProblems, refuseLegacyConfig } from "../../runtime/lib/legacy";

describe("legacyConfigProblems", () => {
  it("finds nothing when an app uses the new names", () => {
    expect(
      legacyConfigProblems({
        env: { NUXT_ZITADEL_PROTECTED_ROUTES: "[]", PATH: "/bin" },
        runtimeConfig: { zitadel: {} },
        publicConfig: { zitadelProxyPath: "/auth" },
      }),
    ).toEqual([]);
  });

  it.each([
    ["the nextgen key", { nextgen: {} }, "the `nextgen` key in nuxt.config.ts is now `zitadel`"],
    [
      "the private runtimeConfig.nextgen object",
      { runtimeConfig: { nextgen: { protectedRoutes: ["/admin"] } } },
      "runtimeConfig.nextgen is now runtimeConfig.zitadel",
    ],
    [
      "runtimeConfig.public.nextgenProxyPath",
      { publicConfig: { nextgenProxyPath: "/auth" } },
      "runtimeConfig.public.nextgenProxyPath is now runtimeConfig.public.zitadelProxyPath",
    ],
    [
      "runtimeConfig.public.nextgenApiBase",
      { publicConfig: { nextgenApiBase: "/auth" } },
      "runtimeConfig.public.nextgenApiBase is now runtimeConfig.public.zitadelApiBase",
    ],
    [
      "a NUXT_NEXTGEN_ variable",
      { env: { NUXT_NEXTGEN_PROTECTED_ROUTES: "/admin" } },
      "NUXT_NEXTGEN_PROTECTED_ROUTES is now NUXT_ZITADEL_PROTECTED_ROUTES",
    ],
    [
      "a NUXT_PUBLIC_NEXTGEN_ variable",
      { env: { NUXT_PUBLIC_NEXTGEN_PROXY_PATH: "/auth" } },
      "NUXT_PUBLIC_NEXTGEN_PROXY_PATH is now NUXT_PUBLIC_ZITADEL_PROXY_PATH",
    ],
  ])("finds %s", (_label, sources, problem) => {
    expect(legacyConfigProblems({ env: {}, ...sources })).toEqual([problem]);
  });
});

describe("refuseLegacyConfig", () => {
  it("throws naming every old setting", () => {
    expect(() =>
      refuseLegacyConfig({ env: { NUXT_NEXTGEN_LOGIN_PATH: "/in" }, nextgen: {} }),
    ).toThrow(/renamed from "nextgen" to "zitadel".*`nextgen` key.*NUXT_NEXTGEN_LOGIN_PATH/);
  });

  it("returns when nothing is old", () => {
    expect(() => refuseLegacyConfig({ env: {} })).not.toThrow();
  });
});
