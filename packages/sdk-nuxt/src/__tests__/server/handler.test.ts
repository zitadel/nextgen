import { createApp, toWebHandler } from "h3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { middlewareOptions } from "../../runtime/server/handler";

/** The options a module that was given none stores: Nitro fills each with "". */
const UNSET_BY_NITRO = {
  ignoredRoutes: "",
  allowedAlgorithms: "",
  allowedTokenTypes: "",
  audience: "",
  clockSkewMs: "",
  jwksTimeoutMs: "",
  proxyTimeoutMs: "",
  opaqueTokenTimeoutMs: "",
  projectSecret: "",
};

/**
 * Builds the server handler the module registers, against the given
 * `runtimeConfig.nextgen`. The handler reads its options when it is imported,
 * so each call imports it afresh after setting the config.
 */
async function moduleHandler(
  nextgen: Record<string, unknown>,
): Promise<ReturnType<typeof toWebHandler>> {
  vi.resetModules();
  const { setRuntimeConfig } = await import("../stubs/nuxt-imports");
  setRuntimeConfig({ nextgen });
  const { default: handler } = await import("../../runtime/server/handler");
  const app = createApp();
  app.use(handler);
  return toWebHandler(app);
}

describe("module server handler", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("proxies the proxyPath the module configured", async () => {
    const upstream = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", upstream);
    const handle = await moduleHandler({ url: "http://zitadel.test", proxyPath: "/auth" });

    const res = await handle(new Request("http://localhost:3000/auth/flow?step=1"));

    expect(res.status).toBe(200);
    expect(upstream).toHaveBeenCalledWith("http://zitadel.test/flow?step=1", expect.anything());
  });

  it("leaves /__nextgen alone when another prefix is configured", async () => {
    const upstream = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", upstream);
    const handle = await moduleHandler({ url: "http://zitadel.test", proxyPath: "/auth" });

    await handle(new Request("http://localhost:3000/__nextgen/flow"));

    expect(upstream).not.toHaveBeenCalled();
  });

  it("proxies /__nextgen when no proxyPath is configured", async () => {
    const upstream = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", upstream);
    const handle = await moduleHandler({ url: "http://zitadel.test" });

    await handle(new Request("http://localhost:3000/__nextgen/flow"));

    expect(upstream).toHaveBeenCalledWith("http://zitadel.test/flow", expect.anything());
  });

  it("skips the ignoredRoutes the module configured", async () => {
    const handle = await moduleHandler({
      url: "http://zitadel.test",
      protectedRoutes: ["/admin*"],
      ignoredRoutes: ["/admin/health"],
    });

    expect((await handle(new Request("http://localhost:3000/admin"))).status).toBe(302);
    expect((await handle(new Request("http://localhost:3000/admin/health"))).status).not.toBe(302);
  });

  it("keeps the default proxy timeout when Nitro stored the unset options as empty strings", async () => {
    // Like a real fetch, fail once the request's signal has aborted: a timeout
    // of "" would abort it at once.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        if (init.signal?.aborted) {
          throw init.signal.reason;
        }
        return new Response("{}", { status: 200 });
      }),
    );
    const handle = await moduleHandler({ url: "http://zitadel.test", ...UNSET_BY_NITRO });

    const res = await handle(new Request("http://localhost:3000/__nextgen/flow"));

    expect(res.status).toBe(200);
  });

  it("sends the project secret the module stored on the handoff exchange", async () => {
    const upstream = vi.fn(async (_url: string, _init: RequestInit) => Response.json({}));
    vi.stubGlobal("fetch", upstream);
    const handle = await moduleHandler({ url: "http://zitadel.test", projectSecret: "sk_module" });

    await handle(
      new Request("http://localhost:3000/__nextgen/sessions/exchange", { method: "POST" }),
    );

    expect(new Headers(upstream.mock.calls[0]?.[1].headers).get("authorization")).toBe(
      "Bearer sk_module",
    );
  });
});

describe("middlewareOptions", () => {
  it("passes on every option the module stored", () => {
    expect(
      middlewareOptions({
        url: "http://zitadel.test",
        proxyPath: "/auth",
        loginPath: "/sign-in",
        protectedRoutes: ["/admin*"],
        ignoredRoutes: ["/health"],
        allowedAlgorithms: ["ES256"],
        allowedTokenTypes: [],
        audience: ["api", "web"],
        clockSkewMs: 1000,
        jwksTimeoutMs: 2000,
        proxyTimeoutMs: 3000,
        opaqueTokenTimeoutMs: 4000,
        projectSecret: "sk_module",
      }),
    ).toEqual({
      url: "http://zitadel.test",
      proxyPath: "/auth",
      loginPath: "/sign-in",
      protectedRoutes: ["/admin*"],
      ignoredRoutes: ["/health"],
      allowedAlgorithms: ["ES256"],
      allowedTokenTypes: [],
      audience: ["api", "web"],
      clockSkewMs: 1000,
      jwksTimeoutMs: 2000,
      proxyTimeoutMs: 3000,
      opaqueTokenTimeoutMs: 4000,
      projectSecret: "sk_module",
    });
  });

  it("leaves the options Nitro stored as empty strings to the middleware's defaults", () => {
    const options = middlewareOptions({ url: "http://zitadel.test", ...UNSET_BY_NITRO });

    for (const key of Object.keys(UNSET_BY_NITRO)) {
      expect(options).toHaveProperty(key, undefined);
    }
  });

  it("reads values that environment overrides deliver as a single string or the wrong type", () => {
    // NUXT_NEXTGEN_AUDIENCE=api arrives as "api"; =5s as the string "5s".
    const options = middlewareOptions({
      audience: "api",
      protectedRoutes: "/admin",
      clockSkewMs: "5s",
    });

    expect(options.audience).toEqual(["api"]);
    expect(options.protectedRoutes).toEqual(["/admin"]);
    expect(options.clockSkewMs).toBeUndefined();
  });
});
