import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FLOW_WRITES, SIGN_IN_PREFIX } from "./contract";
import { forwardSignIn, isApiPath, isFlowWrite } from "./sign-in";

const human = async () => ({ isBot: false, isVerifiedBot: false });
const bot = async () => ({ isBot: true, isVerifiedBot: false });

// Unset unless a test sets it, whatever the shell running the tests exports.
beforeEach(() => vi.stubEnv("CLOUD_ZITADEL_URL", ""));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("the sign-in widget's calls", () => {
  it.each(["", "/api/v1"])(
    "checks only the two calls that start or advance a flow at '%s'",
    (prefix) => {
      expect(isFlowWrite("POST", `${prefix}/flow`)).toBe(true);
      expect(isFlowWrite("POST", `${prefix}/flow/flw_1/submit`)).toBe(true);
      expect(isFlowWrite("GET", `${prefix}/flow/flw_1`)).toBe(false);
      expect(isFlowWrite("POST", `${prefix}/sessions/exchange`)).toBe(false);
    },
  );

  // BotID's client marks only these; a write the check reads that the client
  // never marks is refused for every person.
  it.each(FLOW_WRITES)("checks $method $path, which BotID's client marks", ({ method, path }) => {
    expect(path.startsWith(`${SIGN_IN_PREFIX}/`)).toBe(true);
    const sent = path.slice(SIGN_IN_PREFIX.length).replaceAll("*", "flw_1");
    expect(isFlowWrite(method, sent)).toBe(true);
  });

  // The server answers neither, so neither starts a flow there.
  it.each(["/api/v1/api/v1/flow", "/api/v2/flow", "/api/v1flow"])(
    "does not take %s for a flow write",
    (path) => {
      expect(isFlowWrite("POST", path)).toBe(false);
    },
  );

  it("refuses a flow write from a bot in the server's error envelope, without forwarding it", async () => {
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    const answer = await forwardSignIn(
      new Request("https://cloud.example/cloud/zitadel/api/v1/flow", {
        method: "POST",
        body: "{}",
      }),
      bot,
    );
    expect(answer.status).toBe(403);
    expect(await answer.json()).toMatchObject({ code: "auth.bot_suspected" });
    expect(upstream).not.toHaveBeenCalled();
  });

  it("forwards to the server's own path with the cookie, and hands back what it set", async () => {
    const upstream = vi.fn(
      async () =>
        new Response("{}", {
          status: 200,
          headers: { "set-cookie": "__Host-zitadel_session=new; Path=/; Secure" },
        }),
    );
    vi.stubGlobal("fetch", upstream);
    const answer = await forwardSignIn(
      new Request("https://cloud.example/cloud/zitadel/api/v1/flow/flw_1/submit?x=1", {
        method: "POST",
        headers: { cookie: "__Host-zitadel_session=old", origin: "https://cloud.example" },
        body: "{}",
      }),
      human,
    );
    const [url, init] = upstream.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.href).toBe("https://cloud.example/api/v1/flow/flw_1/submit?x=1");
    expect(new Headers(init.headers).get("cookie")).toBe("__Host-zitadel_session=old");
    expect(answer.headers.getSetCookie()).toEqual(["__Host-zitadel_session=new; Path=/; Secure"]);
  });

  it.each([
    "/cloud/zitadel/api/v1/%66low",
    "/cloud/zitadel/api/v1/flow/flw_1/%73ubmit",
    "/cloud/zitadel/api/v1/flow/",
    "/cloud/zitadel/api/v1//flow",
  ])("refuses %s, a spelling the server could route to a flow write unchecked", async (path) => {
    const verdict = vi.fn(human);
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    const answer = await forwardSignIn(
      new Request(`https://cloud.example${path}`, { method: "POST", body: "{}" }),
      verdict,
    );
    expect(answer.status).toBe(404);
    expect(await answer.json()).toMatchObject({ code: "req.not_found" });
    expect(verdict).not.toHaveBeenCalled();
    expect(upstream).not.toHaveBeenCalled();
  });

  // The server's origin is every other service's too (repo-root vercel.json).
  it.each([
    "/cloud/zitadel",
    "/cloud/zitadel/flow",
    "/cloud/zitadel/docs",
    "/cloud/zitadel/cron/events-retention",
    "/cloud/zitadel/cloud/api/account/ensure",
    "/cloud/zitadel/cloud/zitadel/api/v1/flow",
    "/cloud/zitadel/api/v1",
    "/cloud/zitadel/api/v2/flow",
    "/cloud/zitadel/api/v1flow",
  ])("refuses %s, which is no path of the server's API", async (path) => {
    const verdict = vi.fn(human);
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    const answer = await forwardSignIn(
      new Request(`https://cloud.example${path}`, { method: "POST", body: "{}" }),
      verdict,
    );
    expect(answer.status).toBe(404);
    expect(await answer.json()).toMatchObject({ code: "req.not_found" });
    expect(verdict).not.toHaveBeenCalled();
    expect(upstream).not.toHaveBeenCalled();
  });

  // `new URL(path, server)` resolves dot segments, so one would leave the prefix.
  it.each([
    "/api/v1/../../docs",
    "/api/v1/..",
    "/api/v1/./flow",
    "/api/v1/flow/../../../cloud/zitadel/api/v1/flow",
  ])("takes %s for no path of the API", (path) => {
    expect(isApiPath(path)).toBe(false);
  });

  it("refuses a path whose dot segments lead out of the API", async () => {
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    for (const path of ["/api/v1/../../docs", "/api/v1/%2e%2e/%2E%2E/docs"]) {
      const answer = await forwardSignIn(
        new Request(`https://cloud.example/cloud/zitadel${path}`, { method: "POST", body: "{}" }),
        human,
      );
      expect(answer.status, path).toBe(404);
    }
    expect(upstream).not.toHaveBeenCalled();
  });

  it("forwards to CLOUD_ZITADEL_URL, not its own origin, when it names the server", async () => {
    // As behind the console's dev proxy, which hands the functions their own host.
    vi.stubEnv("CLOUD_ZITADEL_URL", "http://localhost:8094");
    const upstream = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", upstream);
    await forwardSignIn(
      new Request("http://localhost:5180/cloud/zitadel/api/v1/flow", {
        method: "POST",
        body: "{}",
      }),
      human,
    );
    const [url] = upstream.mock.calls[0] as unknown as [URL];
    expect(url.href).toBe("http://localhost:8094/api/v1/flow");
  });
});
