import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEAD,
  JWE_SESSION_TOKEN,
  OFF_ORIGIN_LOCATIONS,
  OUTAGES,
  exchangeAnswer,
} from "./__tests__/outages.js";
import {
  MAX_SESSION_TOKEN_LENGTH,
  SESSION_CHECK_BACKOFF_MS,
  SESSION_UNAVAILABLE_RETRY_AFTER_S,
  assertLoginPath,
  clearCookie,
  clearSessionCheckBackoff,
  filterResponseHeaders,
  isWellFormedSessionToken,
  matchesRoutes,
  parseCookieHeader,
  proxyFailureResponse,
  readSessionAnswer,
  redactExchangeBody,
  requiresProjectSecret,
  sessionUnavailableResponse,
  toClientAuth,
  validateOpaqueSessionToken,
  warnIfLoginPathProtected,
} from "./middleware.js";

// An unknown session check is logged and starts a backoff; neither may leak
// from one test into the next.
beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  clearSessionCheckBackoff();
  vi.restoreAllMocks();
});

/** The upstream response headers for one proxied call. */
function upstream(entries: Record<string, string>): Headers {
  return new Headers(entries);
}

const APP = "https://app.example.com";
/** The callback the provider returns the browser to. */
const CALLBACK = `${APP}/__nextgen/idp/google/callback?code=abc`;

describe("filterResponseHeaders", () => {
  it("forwards a redirect that already points at this app", () => {
    // The identity-provider callback answers `303` back to the page the
    // sign-in started on. It is a top-level navigation with no JavaScript in
    // the loop, so dropping this header leaves the browser on an empty page.
    const filtered = filterResponseHeaders(
      upstream({ location: `${APP}/login?flow=flow_123` }),
      CALLBACK,
    );

    expect(filtered.get("location")).toBe(`${APP}/login?flow=flow_123`);
  });

  it("resolves a path-relative redirect against the request, not the origin root", () => {
    // RFC 3986 §5: a relative reference resolves against the URL it came from.
    // `next?flow=x` answered to `/__nextgen/idp/google/callback` means a sibling of
    // that path, and resolving from `/` would send the browser elsewhere.
    expect(
      filterResponseHeaders(upstream({ location: "next?flow=x" }), CALLBACK).get("location"),
    ).toBe(`${APP}/__nextgen/idp/google/next?flow=x`);
  });

  it("keeps a query-only reference on the same path", () => {
    expect(filterResponseHeaders(upstream({ location: "?flow=x" }), CALLBACK).get("location")).toBe(
      `${APP}/__nextgen/idp/google/callback?flow=x`,
    );
  });

  it("makes a root-relative redirect absolute, because Next rejects a relative one", () => {
    expect(
      filterResponseHeaders(upstream({ location: "/login?flow=x" }), CALLBACK).get("location"),
    ).toBe(`${APP}/login?flow=x`);
  });

  it("keeps the path but never the origin an upstream named", () => {
    // The whole point of the original strip: an internal hostname must never
    // reach the browser. Discarding the origin also means a deployment behind
    // a proxy that rewrites the host still works, instead of having its
    // redirect dropped for naming an origin this process cannot recognise.
    expect(
      filterResponseHeaders(
        upstream({ location: "http://zitadel.internal:8080/login?flow=x" }),
        CALLBACK,
      ).get("location"),
    ).toBe(`${APP}/login?flow=x`);
  });

  it("cannot be turned into a redirect off this app", () => {
    // Including the protocol-relative form, which resolves to another origin
    // and is the shape an open redirect would take.
    for (const location of ["https://evil.com/x", "//evil.com/x"]) {
      expect(
        filterResponseHeaders(upstream({ location }), CALLBACK).get("location"),
        location,
      ).toBe(`${APP}/x`);
    }
  });

  // A path that starts with `//` would read as protocol-relative if the path
  // were re-parsed as a reference, and take its host from the path.
  it.each(OFF_ORIGIN_LOCATIONS)("keeps %s on this app", (location) => {
    const rewritten = filterResponseHeaders(upstream({ location }), CALLBACK).get("location");

    expect(rewritten === null ? null : new URL(rewritten).origin).toBe(APP);
  });

  it("drops a redirect when the caller names no request URL", () => {
    expect(filterResponseHeaders(upstream({ location: `${APP}/login` })).has("location")).toBe(
      false,
    );
  });

  it("drops a location that is not a URL at all", () => {
    expect(
      filterResponseHeaders(upstream({ location: "http://[" }), CALLBACK).has("location"),
    ).toBe(false);
  });

  it("still strips set-cookie and hop-by-hop headers, and keeps the rest", () => {
    const filtered = filterResponseHeaders(
      upstream({
        "content-type": "application/json",
        "set-cookie": "a=1",
        connection: "keep-alive",
      }),
      CALLBACK,
    );

    expect(filtered.get("content-type")).toBe("application/json");
    expect(filtered.has("set-cookie")).toBe(false);
    expect(filtered.has("connection")).toBe(false);
  });
});

describe("matchesRoutes", () => {
  it.each([
    ["/profile", ["/profile"]],
    ["/profile/", ["/profile"]],
    ["/profile", ["/profile/"]],
    ["/profile//", ["/profile"]],
    ["/", ["/"]],
    ["/admin/users", ["/admin*"]],
    ["/admin", ["/admin*"]],
  ])("matches %s against %j", (pathname, routes) => {
    expect(matchesRoutes(pathname, routes)).toBe(true);
  });

  it.each([
    ["/profiles", ["/profile"]],
    ["/profile/edit", ["/profile"]],
    ["/", ["/profile"]],
    ["/profile", ["/"]],
    ["/other", ["/admin*"]],
    ["/profile", []],
  ])("does not match %s against %j", (pathname, routes) => {
    expect(matchesRoutes(pathname, routes)).toBe(false);
  });

  it("treats a path of only slashes as the root", () => {
    expect(matchesRoutes("///", ["/"])).toBe(true);
  });

  // The pathname is attacker-controlled. A backtracking trailing-slash regex
  // takes quadratic time on a long run of slashes; this must stay linear.
  it("matches a pathname of many slashes in linear time", () => {
    const pathname = `/${"/".repeat(200_000)}x`;
    const started = performance.now();

    expect(matchesRoutes(pathname, ["/profile"])).toBe(false);
    expect(performance.now() - started).toBeLessThan(250);
  });
});

describe("requiresProjectSecret", () => {
  it("allows the secret on the handoff exchange", () => {
    expect(requiresProjectSecret("POST", "/sessions/exchange")).toBe(true);
  });

  it("matches the method case-insensitively", () => {
    expect(requiresProjectSecret("post", "/sessions/exchange")).toBe(true);
  });

  it.each([
    ["GET", "/sessions/exchange"],
    ["PUT", "/sessions/exchange"],
    ["POST", "/v1/flow"],
    ["GET", "/v1/flow"],
    ["POST", "/sessions/exchange/"],
    ["POST", "/sessions/exchangex"],
    ["POST", "/sessions"],
  ])("withholds the secret from %s %s", (method, pathname) => {
    expect(requiresProjectSecret(method, pathname)).toBe(false);
  });
});
describe("redactExchangeBody", () => {
  async function redact(method: string, pathname: string, res: Response) {
    const headers = new Headers(res.headers);
    const body = await redactExchangeBody(method, pathname, res, headers);
    return { text: await new Response(body).text(), headers };
  }

  it("drops the session token from the exchange answer", async () => {
    const { text } = await redact("POST", "/sessions/exchange", exchangeAnswer());

    expect(text).not.toContain(JWE_SESSION_TOKEN);
  });

  it("keeps the rest of the exchange answer", async () => {
    const { text } = await redact("POST", "/sessions/exchange", exchangeAnswer());

    expect(JSON.parse(text)).toEqual({
      session: { session_id: "sess_1", user_id: "user_1", state: "active" },
    });
  });

  it("states the length of the body it answers with", async () => {
    const { text, headers } = await redact("POST", "/sessions/exchange", exchangeAnswer());

    expect(headers.get("content-length")).toBe(String(new TextEncoder().encode(text).byteLength));
  });

  it("drops the content encoding fetch has already decoded", async () => {
    const headers = new Headers({ "content-encoding": "gzip" });
    await redactExchangeBody("POST", "/sessions/exchange", exchangeAnswer(), headers);

    expect(headers.has("content-encoding")).toBe(false);
  });

  it("passes an exchange error through", async () => {
    const error = { code: "sess.invalid_handoff_token", message: "The handoff token is invalid." };
    const res = Response.json(error, { status: 400 });

    expect(JSON.parse((await redact("POST", "/sessions/exchange", res)).text)).toEqual(error);
  });

  it("passes a body that is not JSON through", async () => {
    const { text } = await redact("POST", "/sessions/exchange", new Response("<html>"));

    expect(text).toBe("<html>");
  });

  it.each([
    ["GET", "/sessions/exchange"],
    ["POST", "/sessions/exchange/extra"],
    ["POST", "/sessions"],
  ])("leaves the body of %s %s alone", async (method, pathname) => {
    const res = exchangeAnswer();
    const stream = res.body;

    expect(await redactExchangeBody(method, pathname, res, new Headers())).toBe(stream);
  });
});

describe("readSessionAnswer", () => {
  it.each(DEAD)("reads %s as dead", async (_label, answer) => {
    expect(await readSessionAnswer(answer())).toEqual({ status: "dead" });
  });

  const NOT_A_SESSION = "an answer that is not a session";
  it.each([
    ["a 200 that is not a session", () => Response.json({}), NOT_A_SESSION],
    ["an empty session_id", () => Response.json({ session_id: "" }), NOT_A_SESSION],
    ["a numeric session_id", () => Response.json({ session_id: 1 }), NOT_A_SESSION],
    ["an unreadable body", () => new Response("<html>"), "an unreadable response body"],
    [
      "a 401 without the code",
      () => new Response(null, { status: 401 }),
      "HTTP 401 without the backend's error code",
    ],
    ["a 500", () => new Response(null, { status: 500 }), "HTTP 500"],
  ])("reads %s as unknown", async (_label, answer, why) => {
    expect(await readSessionAnswer(answer())).toEqual({ status: "unknown", why });
  });

  it("reads an anonymous session as live with no user", async () => {
    expect(await readSessionAnswer(Response.json({ session_id: "s1" }))).toEqual({
      status: "live",
      session: { userId: null, identifier: null, identifierProperty: null, display: null },
    });
  });
});

describe("validateOpaqueSessionToken", () => {
  function backend(response: Response | Error) {
    const fetchMock = vi.fn(async () => {
      if (response instanceof Error) throw response;
      return response;
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the signed-in user of a live session", async () => {
    backend(
      Response.json({
        session_id: "s1",
        user_id: "u1",
        user: { identifier: "a@b.c", identifier_property: "email", display: "Ada" },
      }),
    );

    expect(await validateOpaqueSessionToken("tok", "http://auth.test", 1000)).toEqual({
      status: "live",
      session: {
        userId: "u1",
        identifier: "a@b.c",
        identifierProperty: "email",
        display: "Ada",
      },
    });
  });

  it("asks the backend for the session the cookie names", async () => {
    const fetchMock = backend(Response.json({ session_id: "s1", user_id: "u1" }));

    await validateOpaqueSessionToken("tok", "http://auth.test", 1000);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://auth.test/sessions/me",
      expect.objectContaining({
        headers: expect.objectContaining({ cookie: "__nextgen_session=tok" }),
      }),
    );
  });

  // CreateSession sets the cookie before any factor is verified.
  it.each([
    [{ session_id: "s1" }],
    [{ session_id: "s1", user_id: "" }],
    [{ session_id: "s1", user_id: 42 }],
    [{ session_id: "s1", user_id: null }],
  ])("reports a live session without a user (%j) as anonymous", async (body) => {
    backend(Response.json(body));

    expect(await validateOpaqueSessionToken("tok", "http://auth.test", 1000)).toMatchObject({
      status: "live",
      session: { userId: null },
    });
  });

  // A UI renders `display ?? identifier`; an empty string would show no name.
  it.each([
    ["an empty display", { display: "" }, { display: null }],
    ["an empty identifier", { identifier: "" }, { identifier: null }],
    ["a non-string display", { display: 7 }, { display: null }],
    ["an empty identifier property", { identifier_property: "" }, { identifierProperty: null }],
  ])("reads %s as null", async (_label, user, expected) => {
    backend(Response.json({ session_id: "s1", user_id: "u1", user }));

    expect(await validateOpaqueSessionToken("tok", "http://auth.test", 1000)).toMatchObject({
      status: "live",
      session: expected,
    });
  });

  it.each(DEAD)("reports the session dead for %s", async (_label, response) => {
    backend(response());

    expect(await validateOpaqueSessionToken("tok", "http://auth.test", 1000)).toEqual({
      status: "dead",
    });
  });

  // An outage is not a sign-out: only the backend saying so is.
  it.each([
    ["a network error", new TypeError("fetch failed")],
    ["a timeout", new DOMException("timed out", "TimeoutError")],
    ["a 500", new Response(null, { status: 500 })],
    ["a 502", new Response(null, { status: 502 })],
    ["a 503", new Response(null, { status: 503 })],
    ["a 429", new Response(null, { status: 429 })],
    ["a 403", new Response(null, { status: 403 })],
    ["an unreadable body", new Response("not json", { status: 200 })],
    ["a 401 without a body", new Response(null, { status: 401 })],
    ["a 404 without a body", new Response(null, { status: 404 })],
    ["a 401 with another code", Response.json({ code: "req.invalid" }, { status: 401 })],
    ["a 404 with the 401 code", Response.json({ code: "auth.unauthorized" }, { status: 404 })],
  ])("reports the session unknown for %s", async (_label, response) => {
    backend(response);

    expect(await validateOpaqueSessionToken("tok", "http://auth.test", 1000)).toEqual({
      status: "unknown",
    });
  });

  it.each(OUTAGES)("reports the session unknown for the shared outage %s", async (_l, answer) => {
    vi.stubGlobal("fetch", vi.fn(answer));

    expect(await validateOpaqueSessionToken("tok", "http://auth.test", 1000)).toEqual({
      status: "unknown",
    });
  });
});

describe("validateOpaqueSessionToken backoff", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    clearSessionCheckBackoff();
  });

  function outage() {
    const fetchMock = vi.fn(
      (): Promise<Response> => Promise.reject(new DOMException("timed out", "TimeoutError")),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("answers unknown without asking the backend again within the backoff", async () => {
    const fetchMock = outage();
    await validateOpaqueSessionToken("tok", "http://auth.test", 1000);
    vi.advanceTimersByTime(SESSION_CHECK_BACKOFF_MS - 1);

    expect(await validateOpaqueSessionToken("tok", "http://auth.test", 1000)).toEqual({
      status: "unknown",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("asks the backend again once the backoff has passed", async () => {
    const fetchMock = outage();
    await validateOpaqueSessionToken("tok", "http://auth.test", 1000);
    fetchMock.mockImplementation(async () => Response.json({ session_id: "s1", user_id: "u1" }));
    vi.advanceTimersByTime(SESSION_CHECK_BACKOFF_MS);

    expect(await validateOpaqueSessionToken("tok", "http://auth.test", 1000)).toMatchObject({
      status: "live",
    });
  });

  it("keeps asking a different backend during another's backoff", async () => {
    const fetchMock = outage();
    await validateOpaqueSessionToken("tok", "http://auth.test", 1000);

    await validateOpaqueSessionToken("tok", "http://other.test", 1000);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("logs an unknown outcome once per backoff window, with its reason", async () => {
    outage();
    for (let i = 0; i < 5; i++) {
      await validateOpaqueSessionToken("tok", "http://auth.test", 1000);
    }

    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("http://auth.test/sessions/me: no answer within 1000ms"),
    );
  });

  it("does not log a dead session", async () => {
    vi.stubGlobal("fetch", vi.fn(DEAD[0]?.[1]));

    await validateOpaqueSessionToken("tok", "http://auth.test", 1000);

    expect(console.warn).not.toHaveBeenCalled();
  });

  it.each([
    ["a network error", () => Promise.reject(new TypeError("fetch failed"))],
    ["a timeout", () => Promise.reject(new DOMException("timed out", "TimeoutError"))],
    ["a 502", () => Promise.resolve(new Response(null, { status: 502 }))],
    ["a 503", () => Promise.resolve(new Response(null, { status: 503 }))],
    ["a 504", () => Promise.resolve(new Response(null, { status: 504 }))],
  ])("backs off after %s, which says the backend is unreachable", async (_label, answer) => {
    const fetchMock = vi.fn(answer);
    vi.stubGlobal("fetch", fetchMock);
    await validateOpaqueSessionToken("tok", "http://auth.test", 1000);

    await validateOpaqueSessionToken("tok", "http://auth.test", 1000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // These answers may come from the request's own token; one request must not
  // make the backend look down for everyone else.
  it.each([
    ["a 500", () => new Response(null, { status: 500 })],
    ["a 429", () => new Response(null, { status: 429 })],
    ["a 403", () => new Response(null, { status: 403 })],
    ["a 401 without the code", () => new Response(null, { status: 401 })],
    ["an unreadable body", () => new Response("<html>", { status: 200 })],
    ["a 200 that is not a session", () => Response.json({ user_id: "u1" })],
  ])("does not back off after %s", async (_label, answer) => {
    const fetchMock = vi.fn(async () => answer());
    vi.stubGlobal("fetch", fetchMock);
    await validateOpaqueSessionToken("tok", "http://auth.test", 1000);

    await validateOpaqueSessionToken("tok", "http://auth.test", 1000);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps validating a live session after a 500 caused by another request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) =>
        new Headers(init.headers).get("cookie") === "__nextgen_session=good"
          ? Response.json({ session_id: "s1", user_id: "u1" })
          : new Response(null, { status: 500 }),
      ),
    );
    await validateOpaqueSessionToken("poison", "http://auth.test", 1000);

    expect(await validateOpaqueSessionToken("good", "http://auth.test", 1000)).toMatchObject({
      status: "live",
    });
  });

  it("logs an answer that starts no backoff once per window", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 500 })),
    );
    for (let i = 0; i < 5; i++) {
      await validateOpaqueSessionToken("tok", "http://auth.test", 1000);
    }
    vi.advanceTimersByTime(SESSION_CHECK_BACKOFF_MS);
    await validateOpaqueSessionToken("tok", "http://auth.test", 1000);

    expect(console.warn).toHaveBeenCalledTimes(2);
  });

  it("does not back off when the request cannot be built", async () => {
    const fetchMock = vi.fn(async () => Response.json({ session_id: "s1", user_id: "u1" }));
    vi.stubGlobal("fetch", fetchMock);
    await validateOpaqueSessionToken("tok", "not a url", 1000);

    await validateOpaqueSessionToken("tok", "not a url", 1000);

    expect([fetchMock.mock.calls.length, vi.mocked(console.warn).mock.calls.length]).toEqual([
      0, 1,
    ]);
  });

  it("outlasts the default session-check timeout", () => {
    expect(SESSION_CHECK_BACKOFF_MS).toBeGreaterThan(5_000);
  });
});

describe("validateOpaqueSessionToken with a malformed token", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // A percent-decoded `%0A` in the cookie reaches the SDK as a newline, which
  // fetch refuses to send. It must not read as a backend outage.
  it.each([
    ["a newline", "x\ny"],
    ["a carriage return", "x\ry"],
    ["a NUL", "x\u0000y"],
    ["a space", "x y"],
    ["a tab", "x\ty"],
    ["a non-ASCII character", "xéy"],
    ["a percent sign", "x%0Ay"],
    ["a semicolon", "x;other=1"],
    ["an empty token", ""],
    ["an over-long token", "a".repeat(MAX_SESSION_TOKEN_LENGTH + 1)],
  ])("reports a token with %s dead without asking the backend", async (_label, token) => {
    const fetchMock = vi.fn(async () => Response.json({ session_id: "s1", user_id: "u1" }));
    vi.stubGlobal("fetch", fetchMock);

    expect([
      await validateOpaqueSessionToken(token, "http://auth.test", 1000),
      fetchMock.mock.calls,
    ]).toEqual([{ status: "dead" }, []]);
  });

  it("keeps validating a live session after a malformed one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ session_id: "s1", user_id: "u1" })),
    );
    await validateOpaqueSessionToken("x\ny", "http://auth.test", 1000);

    expect(await validateOpaqueSessionToken("good", "http://auth.test", 1000)).toMatchObject({
      status: "live",
    });
  });
});

describe("toClientAuth", () => {
  it("drops the session token, which must never reach the browser", () => {
    expect(
      toClientAuth({
        isAuthenticated: true,
        session: {
          userId: "u1",
          identifier: "ada@example.com",
          identifierProperty: "email",
          display: "Ada",
          token: "secret",
        },
      }),
    ).toEqual({
      isAuthenticated: true,
      session: {
        userId: "u1",
        identifier: "ada@example.com",
        identifierProperty: "email",
        display: "Ada",
      },
    });
  });

  it.each([
    [{ isAuthenticated: false as const, session: null }],
    [{ isAuthenticated: false as const, session: null, reason: "unavailable" as const }],
  ])("keeps the signed-out state %j as it is", (auth) => {
    expect(toClientAuth(auth)).toEqual(auth);
  });

  it("keeps an already client-safe result as it is", () => {
    const auth = {
      isAuthenticated: true as const,
      session: { userId: "u1", identifier: null, identifierProperty: null, display: null },
    };

    expect(toClientAuth(auth)).toEqual(auth);
  });
});

describe("isWellFormedSessionToken", () => {
  it.each([
    "eyJhbGciOiJBMjU2R0NNS1ciLCJlbmMiOiJBMjU2R0NNIn0.a-b_c.d.e.f",
    "tok",
    "a".repeat(MAX_SESSION_TOKEN_LENGTH),
  ])("accepts %s", (token) => {
    expect(isWellFormedSessionToken(token)).toBe(true);
  });

  it.each(["", "x\ny", "x y", "xéy", "a=b", "a".repeat(MAX_SESSION_TOKEN_LENGTH + 1)])(
    "rejects %j",
    (token) => {
      expect(isWellFormedSessionToken(token)).toBe(false);
    },
  );
});

describe("validateOpaqueSessionToken under a hanging backend", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** A backend that answers no check until the test times one out. */
  function hanging() {
    const pending: Array<(error: unknown) => void> = [];
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((_resolve, reject) => {
          pending.push(reject);
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const timeOutAll = async () => {
      for (const reject of pending.splice(0)) {
        reject(new DOMException("timed out", "TimeoutError"));
      }
      // Only Date is faked: a real macrotask lets every rejection settle.
      await new Promise((resolve) => setTimeout(resolve, 0));
    };
    return { fetchMock, timeOutAll };
  }

  // A slow answer is an answer: only a failure to reach the backend backs off.
  it("waits for a backend that answers slowly but within the timeout", async () => {
    const answers: Array<(res: Response) => void> = [];
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          answers.push(resolve);
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const checks = [validateOpaqueSessionToken("tok", "http://auth.test", 5000)];
    vi.advanceTimersByTime(1_200);
    for (let i = 0; i < 5; i++) {
      checks.push(validateOpaqueSessionToken("tok", "http://auth.test", 5000));
    }
    for (const answer of answers.splice(0)) {
      answer(Response.json({ session_id: "s1", user_id: "u1" }));
    }
    const outcomes = await Promise.all(checks);

    expect([fetchMock.mock.calls.length, new Set(outcomes.map((o) => o.status))]).toEqual([
      6,
      new Set(["live"]),
    ]);
  });

  it("logs a timed-out probe once, however many checks were waiting on it", async () => {
    const { timeOutAll } = hanging();
    const checks = Array.from({ length: 5 }, () =>
      validateOpaqueSessionToken("tok", "http://auth.test", 5000),
    );
    vi.advanceTimersByTime(5000);
    await timeOutAll();
    await Promise.all(checks);

    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("stops asking a hanging backend once the first check times out", async () => {
    const { fetchMock, timeOutAll } = hanging();
    const checks: Promise<unknown>[] = [];
    // One request every 250ms for 20s against a backend that never answers;
    // every probe times out after 5s.
    for (let t = 0; t < 20_000; t += 250) {
      checks.push(validateOpaqueSessionToken("tok", "http://auth.test", 5000));
      vi.advanceTimersByTime(250);
      if ((t + 250) % 5000 === 0) {
        await timeOutAll();
      }
    }
    await timeOutAll();
    await Promise.all(checks);

    // The 20 checks of the first 5s are sent and wait; the first timeout then
    // starts the 15s backoff, which answers the rest at once.
    expect([fetchMock.mock.calls.length, vi.mocked(console.warn).mock.calls.length]).toEqual([
      20, 1,
    ]);
  });
});

describe("parseCookieHeader", () => {
  it.each([
    [null, {}],
    ["", {}],
    ["a=1", { a: "1" }],
    ["a=1; b=2", { a: "1", b: "2" }],
    [" a = 1 ;b=x=y", { a: "1", b: "x=y" }],
    ["novalue; a=1", { a: "1" }],
    ["=orphan; a=1", { a: "1" }],
    ["a=1; a=2", { a: "2" }],
  ])("parses %j", (header, expected) => {
    expect(Object.fromEntries(parseCookieHeader(header))).toEqual(expected);
  });
});

describe("clearCookie", () => {
  it("expires the cookie on the root path", () => {
    expect(clearCookie("__nextgen_session")).toBe("__nextgen_session=; Path=/; Max-Age=0");
  });
});

describe("sessionUnavailableResponse", () => {
  it("is a retryable 503 that sets no cookie and is never cached", () => {
    const res = sessionUnavailableResponse();

    expect(res.status).toBe(503);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("retry-after")).toBe(String(SESSION_UNAVAILABLE_RETRY_AFTER_S));
  });
});

describe("sessionUnavailableResponse during a backoff", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("fetch failed"))),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("asks a client to come back when the backoff ends", async () => {
    await validateOpaqueSessionToken("tok", "http://auth.test", 1000);
    vi.advanceTimersByTime(4_500);

    expect(sessionUnavailableResponse("http://auth.test").headers.get("retry-after")).toBe(
      String(Math.ceil((SESSION_CHECK_BACKOFF_MS - 4_500) / 1000)),
    );
  });

  it("asks for at least a second in the backoff's last moments", async () => {
    await validateOpaqueSessionToken("tok", "http://auth.test", 1000);
    vi.advanceTimersByTime(SESSION_CHECK_BACKOFF_MS - 1);

    expect(sessionUnavailableResponse("http://auth.test").headers.get("retry-after")).toBe("1");
  });

  it("counts the longest backoff when no backend is named", async () => {
    await validateOpaqueSessionToken("tok", "http://auth.test", 1000);

    expect(sessionUnavailableResponse().headers.get("retry-after")).toBe(
      String(SESSION_CHECK_BACKOFF_MS / 1000),
    );
  });

  it("ignores another backend's backoff", async () => {
    await validateOpaqueSessionToken("tok", "http://auth.test", 1000);

    expect(sessionUnavailableResponse("http://other.test").headers.get("retry-after")).toBe(
      String(SESSION_UNAVAILABLE_RETRY_AFTER_S),
    );
  });

  it("falls back to the default once the backoff has passed", async () => {
    await validateOpaqueSessionToken("tok", "http://auth.test", 1000);
    vi.advanceTimersByTime(SESSION_CHECK_BACKOFF_MS);

    expect(sessionUnavailableResponse("http://auth.test").headers.get("retry-after")).toBe(
      String(SESSION_UNAVAILABLE_RETRY_AFTER_S),
    );
  });
});

describe("proxyFailureResponse", () => {
  it.each([
    ["a timeout", new DOMException("timed out", "TimeoutError"), 504, "proxy.upstream_timeout"],
    ["a network error", new TypeError("fetch failed"), 502, "proxy.upstream_unreachable"],
    ["a non-error rejection", "boom", 502, "proxy.upstream_unreachable"],
  ])("answers %s with %i and the error envelope", async (_label, error, status, code) => {
    const res = proxyFailureResponse(error);

    expect(res.status).toBe(status);
    expect(await res.json()).toMatchObject({ code, message: expect.any(String) });
  });
});

describe("assertLoginPath", () => {
  it.each(["/login", "/auth/sign-in?x=1", "/"])("accepts %s", (loginPath) => {
    expect(() => assertLoginPath(loginPath)).not.toThrow();
  });

  it.each([
    "https://evil.com/phish",
    "//evil.com",
    "login",
    "",
    "/\\evil.example/login",
    "/\t/evil.example/login",
    "/\n/evil.example/login",
    "/ /evil.example/login",
    "/%5Cevil.example/login",
    "/%2F/evil.example/login",
    "/%09/evil.example/login",
    "/%E0%A4%A",
  ])("rejects %j", (loginPath) => {
    expect(() => assertLoginPath(loginPath)).toThrow(/loginPath must be a relative path/);
  });
});

describe("warnIfLoginPathProtected", () => {
  // A visitor without a session would be redirected from /login to /login
  // forever, if the middleware runs there; the framework may keep it away.
  it.each([
    ["/login", ["/*"]],
    ["/login", ["/login"]],
    ["/login/", ["/login"]],
    ["/login?x=1", ["/login"]],
  ])("warns about %s when protectedRoutes %j match it", (loginPath, protectedRoutes) => {
    expect(() => warnIfLoginPathProtected(loginPath, { protectedRoutes })).not.toThrow();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining(`loginPath "${loginPath}" is matched by protectedRoutes`),
    );
  });

  it("warns once per configuration", () => {
    for (let i = 0; i < 3; i++) {
      warnIfLoginPathProtected("/sign-in", { protectedRoutes: ["/sign*"] });
    }

    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["/login", { protectedRoutes: ["/profile", "/admin*"] }],
    ["/login", { protectedRoutes: ["/*"], ignoredRoutes: ["/login"] }],
    ["/login", { protectedRoutes: ["/*"], ignoredRoutes: ["/log*"] }],
  ])("stays quiet about %s with routes %j", (loginPath, routes) => {
    warnIfLoginPathProtected(loginPath, routes);

    expect(console.warn).not.toHaveBeenCalled();
  });
});
