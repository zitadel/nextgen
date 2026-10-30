import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { forwardSignIn, isFlowWrite } from "./sign-in";

const human = async () => ({ isBot: false, isVerifiedBot: false });
const bot = async () => ({ isBot: true, isVerifiedBot: false });

// Unset unless a test sets it, whatever the shell running the tests exports.
beforeEach(() => vi.stubEnv("CLOUD_ZITADEL_URL", ""));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("the sign-in widget's calls", () => {
  it("checks only the two calls that start or advance a flow", () => {
    expect(isFlowWrite("POST", "/flow")).toBe(true);
    expect(isFlowWrite("POST", "/flow/flw_1/submit")).toBe(true);
    expect(isFlowWrite("GET", "/flow/flw_1")).toBe(false);
    expect(isFlowWrite("POST", "/sessions/exchange")).toBe(false);
  });

  it("refuses a flow write from a bot in the server's error envelope, without forwarding it", async () => {
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    const answer = await forwardSignIn(
      new Request("https://cloud.example/cloud/zitadel/flow", { method: "POST", body: "{}" }),
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
      new Request("https://cloud.example/cloud/zitadel/flow/flw_1/submit?x=1", {
        method: "POST",
        headers: { cookie: "__Host-zitadel_session=old", origin: "https://cloud.example" },
        body: "{}",
      }),
      human,
    );
    const [url, init] = upstream.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.href).toBe("https://cloud.example/flow/flw_1/submit?x=1");
    expect(new Headers(init.headers).get("cookie")).toBe("__Host-zitadel_session=old");
    expect(answer.headers.getSetCookie()).toEqual(["__Host-zitadel_session=new; Path=/; Secure"]);
  });

  it.each([
    "/cloud/zitadel/%66low",
    "/cloud/zitadel/flow/flw_1/%73ubmit",
    "/cloud/zitadel/flow/",
    "/cloud/zitadel//flow",
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

  it("forwards to CLOUD_ZITADEL_URL, not its own origin, when it names the server", async () => {
    // As behind the console's dev proxy, which hands the functions their own host.
    vi.stubEnv("CLOUD_ZITADEL_URL", "http://localhost:8094");
    const upstream = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", upstream);
    await forwardSignIn(
      new Request("http://localhost:5180/cloud/zitadel/flow", { method: "POST", body: "{}" }),
      human,
    );
    const [url] = upstream.mock.calls[0] as unknown as [URL];
    expect(url.href).toBe("http://localhost:8094/flow");
  });
});
