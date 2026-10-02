import { afterEach, describe, expect, it, vi } from "vitest";

import { getApiCsrfToken, setApiCsrfRejectionHandler, setApiCsrfToken } from "./auth";
import { ApiError, CSRF_HEADER, apiErrorCode, customFetch } from "./fetch";

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
  setApiCsrfRejectionHandler(undefined);
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

const created = () => new Response(JSON.stringify({ id: "team_1" }), { status: 201 });

describe("customFetch CSRF refusal", () => {
  it("retries once with the token the handler hands back", async () => {
    const sent = scriptedFetch([csrfRefused, created]);
    setApiCsrfToken("stale");
    setApiCsrfRejectionHandler(async () => "fresh");
    await expect(customFetch("http://api.test/teams", { method: "POST", body: "{}" })).resolves.toEqual({
      id: "team_1",
    });
    expect(sent).toEqual(["stale", "fresh"]);
  });

  it("recovers a write that went out without a token", async () => {
    const sent = scriptedFetch([csrfRefused, created]);
    setApiCsrfRejectionHandler(async () => "fresh");
    await expect(customFetch("http://api.test/teams", { method: "POST" })).resolves.toEqual({ id: "team_1" });
    expect(sent).toEqual([null, "fresh"]);
  });

  // The handler hands back nothing when someone else, or nobody, is signed in
  // now: the write is not replayed under a session it was not prepared for.
  it("does not retry when the handler hands back no token", async () => {
    const sent = scriptedFetch([csrfRefused]);
    setApiCsrfToken("stale");
    setApiCsrfRejectionHandler(async () => undefined);
    await expect(customFetch("http://api.test/teams", { method: "POST" })).rejects.toBeInstanceOf(ApiError);
    expect(sent).toEqual(["stale"]);
  });

  it("retries at most once", async () => {
    const sent = scriptedFetch([csrfRefused, csrfRefused]);
    setApiCsrfToken("stale");
    const onRejected = vi.fn(async () => "fresh");
    setApiCsrfRejectionHandler(onRejected);
    await expect(customFetch("http://api.test/teams", { method: "POST" })).rejects.toBeInstanceOf(ApiError);
    expect(sent).toEqual(["stale", "fresh"]);
    expect(onRejected).toHaveBeenCalledOnce();
  });

  it("does not retry a body that can be read only once", async () => {
    const sent = scriptedFetch([csrfRefused]);
    setApiCsrfToken("stale");
    const onRejected = vi.fn(async () => "fresh");
    setApiCsrfRejectionHandler(onRejected);
    await expect(
      customFetch("http://api.test/teams", { method: "POST", body: new ReadableStream() }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(onRejected).not.toHaveBeenCalled();
    expect(sent).toEqual(["stale"]);
  });

  it("leaves other 403 answers and safe methods alone", async () => {
    scriptedFetch([
      () => new Response(JSON.stringify({ code: "team.permission_denied", message: "no" }), { status: 403 }),
      csrfRefused,
    ]);
    setApiCsrfToken("tok");
    const onRejected = vi.fn(async () => "fresh");
    setApiCsrfRejectionHandler(onRejected);
    await expect(customFetch("http://api.test/teams", { method: "POST" })).rejects.toBeInstanceOf(ApiError);
    await expect(customFetch("http://api.test/teams", { method: "GET" })).rejects.toBeInstanceOf(ApiError);
    expect(onRejected).not.toHaveBeenCalled();
  });
});

describe("apiErrorCode", () => {
  it("reads the envelope code from an ApiError or a parsed body", () => {
    expect(apiErrorCode(new ApiError(403, "u", { code: "auth.csrf_invalid" }, "m"))).toBe("auth.csrf_invalid");
    expect(apiErrorCode({ code: "user.not_found" })).toBe("user.not_found");
    expect(apiErrorCode({ raw: "<html>" })).toBeUndefined();
    expect(apiErrorCode(new Error("x"))).toBeUndefined();
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
