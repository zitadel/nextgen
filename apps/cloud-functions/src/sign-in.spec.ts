import { afterEach, describe, expect, it, vi } from "vitest";

import { forwardSignIn, isFlowWrite } from "./sign-in";

const human = async () => ({ isBot: false, isVerifiedBot: false });
const bot = async () => ({ isBot: true, isVerifiedBot: false });

afterEach(() => vi.unstubAllGlobals());

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
          headers: { "set-cookie": "__nextgen_session=new; Path=/" },
        }),
    );
    vi.stubGlobal("fetch", upstream);
    const answer = await forwardSignIn(
      new Request("https://cloud.example/cloud/zitadel/flow/flw_1/submit?x=1", {
        method: "POST",
        headers: { cookie: "__nextgen_flow=f", origin: "https://cloud.example" },
        body: "{}",
      }),
      human,
    );
    const [url, init] = upstream.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.href).toBe("https://cloud.example/flow/flw_1/submit?x=1");
    expect(new Headers(init.headers).get("cookie")).toBe("__nextgen_flow=f");
    expect(answer.headers.getSetCookie()).toEqual(["__nextgen_session=new; Path=/"]);
  });
});
