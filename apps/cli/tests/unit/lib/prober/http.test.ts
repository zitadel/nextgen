import { delay, http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { probeUrl, probeUrls } from "../../../../src/lib/prober/http";

/**
 * msw catches every fetch in this file. Each test installs its own handlers
 * via `server.use(...)`; unhandled requests pass through to the real network
 * (which on a unit test host returns ECONNREFUSED — exactly what we want to
 * exercise the "network error" path).
 */
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());

const URL_A = "http://probe.test/a";
const URL_B = "http://probe.test/b";
const URL_C = "http://probe.test/c";

describe("probeUrl", () => {
  it("returns the predicate's value when the response matches", async () => {
    server.use(
      http.get(URL_A, () => HttpResponse.json({ issuer: "http://probe.test/a" })),
    );

    const result = await probeUrl(URL_A, async (res) => {
      const body = (await res.json()) as { issuer?: unknown };
      return typeof body.issuer === "string" ? body.issuer : null;
    });

    expect(result).toBe("http://probe.test/a");
  });

  it("returns null when the predicate yields null (e.g. wrong body shape)", async () => {
    server.use(http.get(URL_A, () => HttpResponse.json({ wat: 1 })));

    const result = await probeUrl(URL_A, async (res) => {
      const body = (await res.json()) as { issuer?: unknown };
      return typeof body.issuer === "string" ? body.issuer : null;
    });

    expect(result).toBeNull();
  });

  it("returns null on 5xx when the predicate inspects res.ok", async () => {
    server.use(http.get(URL_A, () => new HttpResponse(null, { status: 503 })));

    const result = await probeUrl(URL_A, (res) => (res.ok ? "ok" : null));

    expect(result).toBeNull();
  });

  it("returns null on a network error (unhandled URL → ECONNREFUSED)", async () => {
    const result = await probeUrl("http://127.0.0.1:1/never", () => "should not happen");

    expect(result).toBeNull();
  });

  it("returns null when the response exceeds the timeout", async () => {
    server.use(
      http.get(URL_A, async () => {
        await delay(200);
        return HttpResponse.json({ issuer: "http://probe.test/a" });
      }),
    );

    const result = await probeUrl(URL_A, () => "matched", { timeoutMs: 30 });

    expect(result).toBeNull();
  });

  it("returns null when the predicate itself throws", async () => {
    server.use(http.get(URL_A, () => HttpResponse.json({})));

    const result = await probeUrl(URL_A, () => {
      throw new Error("predicate exploded");
    });

    expect(result).toBeNull();
  });
});

describe("probeUrls", () => {
  it("returns only non-null matches, preserving input order", async () => {
    server.use(
      http.get(URL_A, () => HttpResponse.json({ issuer: "A" })),
      http.get(URL_B, () => new HttpResponse(null, { status: 500 })), // rejected by predicate
      http.get(URL_C, () => HttpResponse.json({ issuer: "C" })),
    );

    const matches = await probeUrls([URL_A, URL_B, URL_C], async (res) => {
      if (!res.ok) return null;
      const body = (await res.json()) as { issuer?: unknown };
      return typeof body.issuer === "string" ? body.issuer : null;
    });

    expect(matches).toEqual([
      { url: URL_A, value: "A" },
      { url: URL_C, value: "C" },
    ]);
  });

  it("returns [] when no URL matches", async () => {
    server.use(
      http.get(URL_A, () => new HttpResponse(null, { status: 404 })),
      http.get(URL_B, () => new HttpResponse(null, { status: 404 })),
    );

    const matches = await probeUrls([URL_A, URL_B], (res) => (res.ok ? "ok" : null));

    expect(matches).toEqual([]);
  });
});
