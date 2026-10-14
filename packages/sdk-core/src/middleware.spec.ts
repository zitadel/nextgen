import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assertLoginPath,
  clearCookie,
  filterResponseHeaders,
  matchesRoutes,
  parseCookieHeader,
  proxyFailureResponse,
  requiresProjectSecret,
  sessionUnavailableResponse,
  validateOpaqueSessionToken,
} from "./middleware.js";

/** The upstream response headers for one proxied call. */
function upstream(entries: Record<string, string>): Headers {
  return new Headers(entries);
}

const APP = "https://app.example.com";
/** The callback the provider returns the browser to. */
const CALLBACK = `${APP}/__nextgen/idp/callback?code=abc`;

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
    // `next?flow=x` answered to `/__nextgen/idp/callback` means a sibling of
    // that path, and resolving from `/` would send the browser elsewhere.
    expect(
      filterResponseHeaders(upstream({ location: "next?flow=x" }), CALLBACK).get("location"),
    ).toBe(`${APP}/__nextgen/idp/next?flow=x`);
  });

  it("keeps a query-only reference on the same path", () => {
    expect(filterResponseHeaders(upstream({ location: "?flow=x" }), CALLBACK).get("location")).toBe(
      `${APP}/__nextgen/idp/callback?flow=x`,
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
    const fetchMock = backend(Response.json({ user_id: "u1" }));

    await validateOpaqueSessionToken("tok", "http://auth.test", 1000);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://auth.test/sessions/me",
      expect.objectContaining({
        headers: expect.objectContaining({ cookie: "__nextgen_session=tok" }),
      }),
    );
  });

  // CreateSession sets the cookie before any factor is verified.
  it.each([[{}], [{ user_id: "" }], [{ user_id: 42 }], [{ user_id: null }]])(
    "reports a live session without a user (%j) as anonymous",
    async (body) => {
      backend(Response.json(body));

      expect(await validateOpaqueSessionToken("tok", "http://auth.test", 1000)).toMatchObject({
        status: "live",
        session: { userId: null },
      });
    },
  );

  // A UI renders `display ?? identifier`; an empty string would show no name.
  it.each([
    ["an empty display", { display: "" }, { display: null }],
    ["an empty identifier", { identifier: "" }, { identifier: null }],
    ["a non-string display", { display: 7 }, { display: null }],
    ["an empty identifier property", { identifier_property: "" }, { identifierProperty: null }],
  ])("reads %s as null", async (_label, user, expected) => {
    backend(Response.json({ user_id: "u1", user }));

    expect(await validateOpaqueSessionToken("tok", "http://auth.test", 1000)).toMatchObject({
      status: "live",
      session: expected,
    });
  });

  it.each([
    ["a 401", new Response(null, { status: 401 })],
    ["a 404", new Response(null, { status: 404 })],
  ])("reports the session dead for %s", async (_label, response) => {
    backend(response);

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
    ["an unreadable body", new Response("not json", { status: 200 })],
  ])("reports the session unknown for %s", async (_label, response) => {
    backend(response);

    expect(await validateOpaqueSessionToken("tok", "http://auth.test", 1000)).toEqual({
      status: "unknown",
    });
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
    expect(res.headers.get("retry-after")).toBe("5");
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

  it.each(["https://evil.com/phish", "//evil.com", "login", ""])("rejects %j", (loginPath) => {
    expect(() => assertLoginPath(loginPath)).toThrow(/loginPath must be a relative path/);
  });
});
