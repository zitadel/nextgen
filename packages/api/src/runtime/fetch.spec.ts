import { afterEach, describe, expect, it, vi } from "vitest";

import { getApiCsrfToken, setApiCsrfToken, setApiCsrfTokenRefresher } from "./auth";
import { ApiError, CSRF_HEADER, customFetch } from "./fetch";

function captureFetch() {
  const seen: Headers[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      seen.push(new Headers(init.headers));
      return new Response(null, { status: 204 });
    }),
  );
  return seen;
}

afterEach(() => {
  setApiCsrfToken(undefined);
  setApiCsrfTokenRefresher(undefined);
  vi.unstubAllGlobals();
});

/** Answers each request with the next response; records the CSRF header sent. */
function scriptedFetch(responses: Array<() => Response>) {
  const sent: Array<string | null> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      sent.push(new Headers(init.headers).get(CSRF_HEADER));
      const next = responses.shift();
      if (!next) throw new Error("unexpected request");
      return next();
    }),
  );
  return sent;
}

const csrfRefused = () =>
  new Response(JSON.stringify({ code: "auth.csrf_invalid", message: "refused" }), { status: 403 });
const created = () => new Response(JSON.stringify({ id: "team_1" }), { status: 201 });

describe("customFetch CSRF header", () => {
  it("sends the token on unsafe methods", async () => {
    const seen = captureFetch();
    setApiCsrfToken("tok");
    for (const method of ["POST", "PATCH", "DELETE", "put"]) {
      await customFetch("http://api.test/x", { method });
    }
    expect(seen.map((headers) => headers.get(CSRF_HEADER))).toEqual(["tok", "tok", "tok", "tok"]);
  });

  it("leaves safe methods alone", async () => {
    const seen = captureFetch();
    setApiCsrfToken("tok");
    await customFetch("http://api.test/x", {});
    await customFetch("http://api.test/x", { method: "GET" });
    expect(seen.map((headers) => headers.has(CSRF_HEADER))).toEqual([false, false]);
  });

  it("adds nothing when no token is set", async () => {
    const seen = captureFetch();
    await customFetch("http://api.test/x", { method: "POST" });
    expect(seen[0]?.has(CSRF_HEADER)).toBe(false);
  });

  it("keeps a header the caller set itself", async () => {
    const seen = captureFetch();
    setApiCsrfToken("tok");
    await customFetch("http://api.test/x", { method: "POST", headers: { [CSRF_HEADER]: "own" } });
    expect(seen[0]?.get(CSRF_HEADER)).toBe("own");
  });
});

describe("customFetch stale CSRF token", () => {
  it("re-reads the token once and retries with it", async () => {
    const sent = scriptedFetch([csrfRefused, created]);
    setApiCsrfToken("stale");
    setApiCsrfTokenRefresher(async () => "fresh");
    await expect(customFetch("http://api.test/teams", { method: "POST", body: "{}" })).resolves.toEqual({
      id: "team_1",
    });
    expect(sent).toEqual(["stale", "fresh"]);
  });

  it("does not retry a second time", async () => {
    const sent = scriptedFetch([csrfRefused, csrfRefused]);
    setApiCsrfToken("stale");
    setApiCsrfTokenRefresher(async () => "fresh");
    await expect(customFetch("http://api.test/teams", { method: "POST" })).rejects.toBeInstanceOf(ApiError);
    expect(sent).toEqual(["stale", "fresh"]);
  });

  it("leaves other 403 answers alone", async () => {
    const sent = scriptedFetch([
      () => new Response(JSON.stringify({ code: "team.permission_denied", message: "no" }), { status: 403 }),
    ]);
    setApiCsrfToken("tok");
    const refresh = vi.fn(async () => "fresh");
    setApiCsrfTokenRefresher(refresh);
    await expect(customFetch("http://api.test/teams", { method: "POST" })).rejects.toBeInstanceOf(ApiError);
    expect(refresh).not.toHaveBeenCalled();
    expect(sent).toEqual(["tok"]);
  });

  it("does not retry without a refresher, or when the token did not change", async () => {
    scriptedFetch([csrfRefused]);
    setApiCsrfToken("tok");
    await expect(customFetch("http://api.test/teams", { method: "POST" })).rejects.toBeInstanceOf(ApiError);

    const sent = scriptedFetch([csrfRefused]);
    setApiCsrfTokenRefresher(async () => "tok");
    await expect(customFetch("http://api.test/teams", { method: "POST" })).rejects.toBeInstanceOf(ApiError);
    expect(sent).toEqual(["tok"]);
  });
});

describe("CSRF token slot", () => {
  it("is shared through globalThis, so another copy of the module sees it", () => {
    setApiCsrfToken("tok");
    const slot = (globalThis as Record<symbol, { token?: string } | undefined>)[
      Symbol.for("@zitadel/api/auth:csrf")
    ];
    expect(slot?.token).toBe("tok");
    if (!slot) throw new Error("the slot must exist once a token was set");
    slot.token = "from-another-copy";
    expect(getApiCsrfToken()).toBe("from-another-copy");
  });
});
