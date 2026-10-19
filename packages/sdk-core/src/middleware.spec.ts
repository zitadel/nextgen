import { createSign, generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearJwksCache } from "./jwt.js";
import {
  HOP_BY_HOP,
  checkOpaqueSessionToken,
  filterResponseHeaders,
  matchesRoutes,
  jwtNamesProject,
  requiresProjectSecret,
  resolveSession,
  type ResolveSessionOptions,
  validateOpaqueSessionToken,
} from "./middleware.js";

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

describe("HOP_BY_HOP", () => {
  it("includes content-length, so a re-sent body gets the length the fetch implementation computes", () => {
    expect(HOP_BY_HOP.has("content-length")).toBe(true);
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
  const PROJECT = "proj_app";

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
        project_id: PROJECT,
        user_id: "u1",
        user: { identifier: "a@b.c", identifier_property: "email", display: "Ada" },
      }),
    );

    expect(await validateOpaqueSessionToken("tok", "http://auth.test", 1000, PROJECT)).toEqual({
      userId: "u1",
      identifier: "a@b.c",
      identifierProperty: "email",
      display: "Ada",
    });
  });

  it("asks the backend for the session the cookie names, in this app's project", async () => {
    const fetchMock = backend(Response.json({ project_id: PROJECT, user_id: "u1" }));

    await validateOpaqueSessionToken("tok", "http://auth.test", 1000, PROJECT);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://auth.test/sessions/me?project_id=proj_app",
      expect.objectContaining({ headers: { cookie: "__nextgen_session=tok" } }),
    );
  });

  // CreateSession sets the cookie before any factor is verified.
  it.each([[{ project_id: PROJECT }], [{ project_id: PROJECT, user_id: "" }]])(
    "reports a live session without a user (%j) as anonymous",
    async (body) => {
      backend(Response.json(body));

      expect(
        await validateOpaqueSessionToken("tok", "http://auth.test", 1000, PROJECT),
      ).toMatchObject({ userId: null });
    },
  );

  // Live in its own project, so not dead: callers keep its cookie.
  it.each([
    ["the backend refuses", Response.json({ code: "sess.project_mismatch" }, { status: 403 })],
    [
      "a backend that predates project_id answers",
      Response.json({ project_id: "proj_other", user_id: "u1", user: { identifier: "a@b.c" } }),
    ],
    ["the answer names no project", Response.json({ user_id: "u1" })],
  ])("reports no user when %s for another project", async (_label, response) => {
    backend(response);

    expect(await validateOpaqueSessionToken("tok", "http://auth.test", 1000, PROJECT)).toEqual({
      userId: null,
      identifier: null,
      identifierProperty: null,
      display: null,
    });
  });

  it("reports no user, without asking the backend, when no project is configured", async () => {
    const fetchMock = backend(Response.json({ user_id: "u1" }));

    expect(await validateOpaqueSessionToken("tok", "http://auth.test", 1000, "")).toMatchObject({
      userId: null,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["a 401", new Response(null, { status: 401 })],
    ["a 404", new Response(null, { status: 404 })],
    ["a 403 for another reason", Response.json({ code: "auth.csrf_invalid" }, { status: 403 })],
    ["an unreadable body", new Response("not json", { status: 200 })],
    ["a network error", new Error("ECONNREFUSED")],
  ])("reports no live session for %s", async (_label, response) => {
    backend(response);

    expect(await validateOpaqueSessionToken("tok", "http://auth.test", 1000, PROJECT)).toBeNull();
  });
});

describe("jwtNamesProject", () => {
  it.each([
    [true, "names the project", "proj_app"],
    [true, "lists the project among others", ["https://api.example.com", "proj_app"]],
    [false, "names another project", "proj_other"],
    [false, "lists only other audiences", ["proj_other"]],
    [false, "is absent", undefined],
  ])("is %s when the audience %s", (expected, _label, aud) => {
    expect(jwtNamesProject({ aud }, "proj_app")).toBe(expected);
  });

  it("never matches an empty project id", () => {
    expect(jwtNamesProject({ aud: "" }, "")).toBe(false);
  });
});

describe("checkOpaqueSessionToken", () => {
  const PROJECT = "proj_app";

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function answer(response: Response | Error): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        if (response instanceof Error) throw response;
        return response;
      }),
    );
  }

  it.each([
    ["a 401", new Response(null, { status: 401 })],
    ["a 404", new Response(null, { status: 404 })],
  ])("reads %s as a dead session", async (_label, response) => {
    answer(response);

    expect(await checkOpaqueSessionToken("tok", "http://auth.test", 1000, PROJECT)).toEqual({
      state: "dead",
    });
  });

  // The server answers 500, not 401, when it cannot judge a token, so a
  // failing backend never reads as a sign-out.
  it.each([
    ["a 500", new Response(null, { status: 500 }), 500],
    ["a 503", new Response(null, { status: 503 }), 503],
    ["a 400 for the request itself", Response.json({ code: "req.invalid" }, { status: 400 }), 400],
    ["a 403 for another reason", new Response("<html>Forbidden</html>", { status: 403 }), 403],
    ["an unreadable body", new Response("not json", { status: 200 }), null],
    ["a network error", new Error("ECONNREFUSED"), null],
  ])("reads %s as no verdict", async (_label, response, status) => {
    answer(response);

    expect(await checkOpaqueSessionToken("tok", "http://auth.test", 1000, PROJECT)).toEqual({
      state: "unknown",
      status,
    });
  });

  it("reads the backend's refusal for another project as a live session with no user", async () => {
    answer(Response.json({ code: "sess.project_mismatch" }, { status: 403 }));

    expect(await checkOpaqueSessionToken("tok", "http://auth.test", 1000, PROJECT)).toMatchObject({
      state: "live",
      session: { userId: null },
    });
  });

  it("reads a session of this project as live, with its user", async () => {
    answer(Response.json({ project_id: PROJECT, user_id: "u1" }));

    expect(await checkOpaqueSessionToken("tok", "http://auth.test", 1000, PROJECT)).toMatchObject({
      state: "live",
      session: { userId: "u1" },
    });
  });
});

describe("resolveSession", () => {
  const PROJECT = "proj_app";
  const ISSUER = "http://auth.test";
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };

  function base64url(input: string | Buffer): string {
    return Buffer.from(input).toString("base64url");
  }

  function jwt(claims: Record<string, unknown>): string {
    const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "k1" }));
    const body = base64url(
      JSON.stringify({ iss: ISSUER, exp: Math.floor(Date.now() / 1000) + 3600, ...claims }),
    );
    const signature = createSign("SHA256").update(`${header}.${body}`).sign(privateKey);
    return `${header}.${body}.${base64url(signature)}`;
  }

  const options: ResolveSessionOptions = {
    url: ISSUER,
    projectId: PROJECT,
    allowedAlgorithms: ["RS256"],
    clockSkewMs: 5000,
    audience: undefined,
    allowedTokenTypes: ["JWT"],
    jwksTimeoutMs: 1000,
    opaqueTokenTimeoutMs: 1000,
  };

  /** Serves the JWKS, and answers `GET /sessions/me` with `sessionsMe`. */
  function backend(sessionsMe: () => Response | Promise<Response>) {
    const fetchMock = vi.fn(async (url: string | URL) =>
      String(url).endsWith("/auth/keys") ? Response.json({ keys: [jwk] }) : sessionsMe(),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  beforeEach(() => {
    clearJwksCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    [
      "an opaque session of this project",
      () => Response.json({ project_id: PROJECT, user_id: "u1" }),
      { signedIn: true, clearCookies: false },
    ],
    [
      "an anonymous opaque session",
      () => Response.json({ project_id: PROJECT }),
      { signedIn: false, clearCookies: false },
    ],
    [
      "another project's opaque session",
      () => Response.json({ code: "sess.project_mismatch" }, { status: 403 }),
      { signedIn: false, clearCookies: false },
    ],
    [
      "a dead opaque session",
      () => new Response(null, { status: 401 }),
      { signedIn: false, clearCookies: true },
    ],
    [
      "a backend that is down",
      () => new Response(null, { status: 503 }),
      { signedIn: false, clearCookies: false },
    ],
    [
      "a backend that does not answer",
      () => Promise.reject(new TypeError("fetch failed")),
      { signedIn: false, clearCookies: false },
    ],
  ])("judges a cookie holding %s", async (_label, sessionsMe, expected) => {
    backend(sessionsMe);

    const { auth, clearCookies } = await resolveSession(
      { bearer: null, cookie: "opaque-token" },
      options,
    );

    expect({ signedIn: auth.isAuthenticated, clearCookies }).toEqual(expected);
  });

  it.each([
    ["a JWT of this project", { sub: "u1", aud: PROJECT }, { signedIn: true, clearCookies: false }],
    [
      "a JWT of another project",
      { sub: "u1", aud: "proj_other" },
      { signedIn: false, clearCookies: false },
    ],
    [
      "a JWT of this project without a user",
      { aud: PROJECT },
      { signedIn: false, clearCookies: true },
    ],
    [
      "an expired JWT",
      { sub: "u1", aud: PROJECT, exp: 1 },
      { signedIn: false, clearCookies: true },
    ],
  ])("judges a cookie holding %s", async (_label, claims, expected) => {
    backend(() => new Response(null, { status: 500 }));

    const { auth, clearCookies } = await resolveSession(
      { bearer: null, cookie: jwt(claims) },
      options,
    );

    expect({ signedIn: auth.isAuthenticated, clearCookies }).toEqual(expected);
  });

  // A Bearer token and the cookie are separate credentials: a Bearer token that
  // is not this app's leaves the cookie to be judged on its own.
  it.each([
    ["of another project", jwt({ sub: "bearer-user", aud: "proj_other" })],
    ["without a user", jwt({ aud: PROJECT })],
    ["that fails verification", `${jwt({ sub: "bearer-user", aud: PROJECT }).slice(0, -4)}AAAA`],
    ["that is no JWT", "opaque-bearer"],
  ])("judges the cookie on its own behind a Bearer token %s", async (_label, bearer) => {
    const fetchMock = backend(() => Response.json({ project_id: PROJECT, user_id: "cookie-user" }));

    const resolved = await resolveSession({ bearer, cookie: "opaque-token" }, options);

    expect(resolved).toMatchObject({
      auth: { isAuthenticated: true, session: { userId: "cookie-user", token: "opaque-token" } },
      clearCookies: false,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `${ISSUER}/sessions/me?project_id=${PROJECT}`,
      expect.anything(),
    );
  });

  it("keeps a dead cookie it never judged behind a Bearer token that signs in", async () => {
    const fetchMock = backend(() => new Response(null, { status: 401 }));
    const bearer = jwt({ sub: "bearer-user", aud: PROJECT });

    const resolved = await resolveSession({ bearer, cookie: "opaque-token" }, options);

    expect(resolved).toMatchObject({
      auth: { isAuthenticated: true, session: { userId: "bearer-user", token: bearer } },
      clearCookies: false,
    });
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining("/sessions/me"),
      expect.anything(),
    );
  });

  it("signs in no one, and clears nothing, without a project", async () => {
    const fetchMock = backend(() => Response.json({ project_id: PROJECT, user_id: "u1" }));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(
      await resolveSession({ bearer: null, cookie: "opaque-token" }, { ...options, projectId: "" }),
    ).toEqual({ auth: { isAuthenticated: false, session: null }, clearCookies: false });
    expect(fetchMock).not.toHaveBeenCalled();
    error.mockRestore();
  });
});
