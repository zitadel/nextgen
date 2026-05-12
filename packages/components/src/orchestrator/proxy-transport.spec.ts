import { describe, expect, it, vi } from "vitest";

import { ProxyTransport } from "./proxy-transport.js";
import { FlowTransportError } from "./transport.js";

/**
 * Bridge contract between the orchestrator and the SDK auth proxy. The
 * proxy speaks a deliberately-narrow `/v1/flow {action,...}` shape; this
 * transport adapts it into the orchestrator's `FlowResponse` envelope until
 * the typed `@zitadel-nextgen/api` client lands.
 */
describe("ProxyTransport", () => {
  it("synthesises a login step from a successful init response", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ name: "login", csrf_token: "csrf-1" }), { status: 200 }),
    );
    const transport = new ProxyTransport({
      proxyBase: "/__nextgen",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const response = await transport.start({ purpose: "login" });
    expect(response.session_id).toBeTruthy();
    expect(response.session_token).toBeTruthy();
    expect(response.step.type).toBe("login");
    expect(response.step.fields).toMatchObject({
      email: { type: "email", required: true },
      password: { type: "password", required: true },
    });
    expect(response.step.actions?.submit?.primary).toBe(true);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/__nextgen/v1/flow");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(JSON.parse(init.body as string)).toEqual({ action: "init" });
  });

  it("strips a trailing slash from proxyBase", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    const transport = new ProxyTransport({
      proxyBase: "/__nextgen/",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    await transport.start({ purpose: "login" });
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[0]).toBe(
      "/__nextgen/v1/flow",
    );
  });

  it("forwards the cached CSRF token on submit", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ name: "login", csrf_token: "csrf-1" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ name: "success", status: "complete" }), { status: 200 }),
      );

    const transport = new ProxyTransport({
      proxyBase: "/__nextgen",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    await transport.start({ purpose: "login" });
    const response = await transport.submit({
      session_id: "x",
      session_token: "y",
      payload: { values: { email: "alice@acme.com", password: "hunter2" } },
    });

    expect(response.step.type).toBe("complete");
    const [, submitInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    const headers = submitInit.headers as Record<string, string>;
    expect(headers["X-CSRF-Token"]).toBe("csrf-1");
    expect(JSON.parse(submitInit.body as string)).toEqual({
      action: "submit",
      email: "alice@acme.com",
      password: "hunter2",
    });
  });

  it("re-renders the login step with an error message when submit fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ name: "login" }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ name: "error", message: "Bad creds" }), { status: 200 }),
      );

    const transport = new ProxyTransport({
      proxyBase: "/__nextgen",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    await transport.start({ purpose: "login" });
    const response = await transport.submit({
      session_id: "x",
      session_token: "y",
      payload: { values: { email: "alice@acme.com", password: "wrong" } },
    });
    expect(response.step.type).toBe("login");
    expect(response.step.errors?.[0]?.message).toBe("Bad creds");
  });

  it("throws FlowTransportError on non-2xx responses", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: "boom" }), { status: 500 }),
    );
    const transport = new ProxyTransport({
      proxyBase: "/__nextgen",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    await expect(transport.start({ purpose: "login" })).rejects.toBeInstanceOf(
      FlowTransportError,
    );
  });
});
