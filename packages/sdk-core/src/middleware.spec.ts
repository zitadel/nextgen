import { createSign, generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { clearJwksCache } from "./jwt.js";
import {
  HOP_BY_HOP,
  SERVER_SESSION_COOKIE,
  filterResponseHeaders,
  matchesRoutes,
  jwtNamesProject,
  proxySessionCookies,
  requiresProjectSecret,
  resolveSession,
  serializeSessionCookie,
  sessionCookieName,
  validateOpaqueSessionToken,
  type ProxiedRequest,
  type ResolveSessionOptions,
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
        expires_at: "2030-01-01T00:00:00Z",
        user: { identifier: "a@b.c", identifier_property: "email", display: "Ada" },
      }),
    );

    expect(await validateOpaqueSessionToken("tok", "http://auth.test", 1000, PROJECT)).toEqual({
      userId: "u1",
      identifier: "a@b.c",
      identifierProperty: "email",
      display: "Ada",
      expiresAt: "2030-01-01T00:00:00Z",
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
      expiresAt: null,
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

describe("sessionCookieName", () => {
  it("appends the project id to the server's name", () => {
    expect(sessionCookieName("proj_01K7ZD3E")).toBe("__nextgen_session_proj_01K7ZD3E");
  });

  it("keeps the hyphens of a UUID", () => {
    expect(sessionCookieName("proj_3f2b6c1e-8a4d-4f1b-9c2e-7d5a1b0c9e8f")).toBe(
      "__nextgen_session_proj_3f2b6c1e-8a4d-4f1b-9c2e-7d5a1b0c9e8f",
    );
  });

  it("percent-encodes what a cookie name cannot hold", () => {
    expect(sessionCookieName("a b;c=ü")).toBe("__nextgen_session_a%20b%3Bc%3D%C3%BC");
  });
});

describe("serializeSessionCookie", () => {
  it("gives the cookie the attributes the server gives its own session cookie", () => {
    expect(
      serializeSessionCookie({
        name: "__nextgen_session_p",
        value: "tok",
        maxAge: 60,
        secure: true,
      }),
    ).toBe("__nextgen_session_p=tok; Path=/; Max-Age=60; HttpOnly; SameSite=Lax; Secure");
  });

  it("keeps a cookie without a Max-Age for the browser session", () => {
    expect(
      serializeSessionCookie({ name: "n", value: "v", maxAge: undefined, secure: false }),
    ).toBe("n=v; Path=/; HttpOnly; SameSite=Lax");
  });
});

describe("proxySessionCookies", () => {
  const PROJECT = "proj_app";
  const OWN = "__nextgen_session_proj_app";

  function proxied(overrides: Partial<ProxiedRequest> = {}): ProxiedRequest {
    return {
      method: "GET",
      path: "/flow",
      search: "",
      cookie: null,
      requestUrl: "http://localhost:3000/__nextgen/flow",
      ...overrides,
    };
  }

  function answer(status: number, body: unknown, setCookies: string[] = []): Response {
    const headers = new Headers({ "content-type": "application/json" });
    for (const setCookie of setCookies) {
      headers.append("set-cookie", setCookie);
    }
    return new Response(JSON.stringify(body), { status, headers });
  }

  it("sends the project's session cookie up under the server's name", () => {
    const cookies = proxySessionCookies(
      proxied({ cookie: `theme=dark; ${OWN}=mine; _zflow=f` }),
      PROJECT,
    );

    expect(cookies.upstreamCookie).toBe("theme=dark; _zflow=f; __nextgen_session=mine");
  });

  it("keeps every other session cookie back", () => {
    const cookies = proxySessionCookies(
      proxied({
        cookie: "__nextgen_session=console; __nextgen_session_proj_other=other; _zflow=f",
      }),
      PROJECT,
    );

    expect(cookies.upstreamCookie).toBe("_zflow=f");
  });

  it("sends no Cookie header when nothing is left to send", () => {
    const cookies = proxySessionCookies(proxied({ cookie: "__nextgen_session=console" }), PROJECT);

    expect(cookies.upstreamCookie).toBeNull();
  });

  it("renames the server's session cookie on the way back, set or cleared", async () => {
    const cookies = proxySessionCookies(proxied(), PROJECT);

    const { setCookies } = await cookies.toBrowser(
      answer(200, {}, [
        "__nextgen_session=tok; Path=/; Max-Age=3600; HttpOnly; SameSite=Lax",
        "__nextgen_session=; Path=/; Max-Age=0",
        "_zflow=; Path=/; Max-Age=0",
      ]),
    );

    expect(setCookies).toEqual([
      `${OWN}=tok; Path=/; Max-Age=3600; HttpOnly; SameSite=Lax`,
      `${OWN}=; Path=/; Max-Age=0`,
      "_zflow=; Path=/; Max-Age=0",
    ]);
  });

  it("passes the cookies through as they are without a project", async () => {
    const cookies = proxySessionCookies(
      proxied({ cookie: "__nextgen_session=tok; a=b" }),
      undefined,
    );

    const { setCookies } = await cookies.toBrowser(
      answer(200, {}, ["__nextgen_session=tok; Path=/"]),
    );

    expect(cookies.upstreamCookie).toBe("__nextgen_session=tok; a=b");
    expect(setCookies).toEqual(["__nextgen_session=tok; Path=/"]);
  });

  describe("a session kept under the server's name", () => {
    const PROBE = { method: "GET", path: "/sessions/me", search: `?project_id=${PROJECT}` };

    it("goes up to the session probe of this project", () => {
      const cookies = proxySessionCookies(
        proxied({ ...PROBE, cookie: "__nextgen_session=old" }),
        PROJECT,
      );

      expect(cookies.upstreamCookie).toBe("__nextgen_session=old");
    });

    it.each([
      ["DELETE /sessions/me", { method: "DELETE", path: "/sessions/me", search: PROBE.search }],
      ["the probe without a project", { method: "GET", path: "/sessions/me", search: "" }],
      [
        "the probe of another project",
        { method: "GET", path: "/sessions/me", search: "?project_id=proj_other" },
      ],
      ["GET /sessions/me/csrf", { method: "GET", path: "/sessions/me/csrf", search: "" }],
      ["GET /users/me", { method: "GET", path: "/users/me", search: "" }],
    ])("stays back from %s", (_label, request) => {
      const cookies = proxySessionCookies(
        proxied({ ...request, cookie: "__nextgen_session=old" }),
        PROJECT,
      );

      expect(cookies.upstreamCookie).toBeNull();
    });

    it("stays back when the project's own cookie is there", () => {
      const cookies = proxySessionCookies(
        proxied({ ...PROBE, cookie: `__nextgen_session=old; ${OWN}=mine` }),
        PROJECT,
      );

      expect(cookies.upstreamCookie).toBe("__nextgen_session=mine");
    });

    it("moves to the project's cookie when the probe signs its user in", async () => {
      const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
      const body = { project_id: PROJECT, user_id: "u1", expires_at: expiresAt };
      const cookies = proxySessionCookies(
        proxied({ ...PROBE, cookie: "__nextgen_session=old" }),
        PROJECT,
      );

      const forBrowser = await cookies.toBrowser(answer(200, body));

      expect(forBrowser.setCookies).toHaveLength(2);
      expect(forBrowser.setCookies[0]).toMatch(
        new RegExp(`^${OWN}=old; Path=/; Max-Age=(3599|3600); HttpOnly; SameSite=Lax$`),
      );
      expect(forBrowser.setCookies[1]).toBe(
        "__nextgen_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax",
      );
      expect(JSON.parse(String(forBrowser.body))).toEqual(body);
    });

    it.each([
      ["another project's session", 403, { code: "sess.project_mismatch" }],
      ["an anonymous session", 200, { project_id: PROJECT }],
      ["an answer for another project", 200, { project_id: "proj_other", user_id: "u1" }],
      ["a dead session", 401, { code: "auth.unauthorized" }],
    ])("stays where it is when the probe finds %s", async (_label, status, body) => {
      const cookies = proxySessionCookies(
        proxied({ ...PROBE, cookie: "__nextgen_session=old" }),
        PROJECT,
      );

      const forBrowser = await cookies.toBrowser(answer(status, body));

      expect(forBrowser.setCookies).toEqual([]);
    });

    it("moves with Secure where the app is served over https", async () => {
      const cookies = proxySessionCookies(
        proxied({
          ...PROBE,
          cookie: "__nextgen_session=old",
          requestUrl: "https://app.example.com/__nextgen/sessions/me",
        }),
        PROJECT,
      );

      const { setCookies } = await cookies.toBrowser(
        answer(200, { project_id: PROJECT, user_id: "u1" }),
      );

      expect(setCookies[0]).toBe(`${OWN}=old; Path=/; HttpOnly; SameSite=Lax; Secure`);
    });
  });
});

describe("resolveSession", () => {
  const PROJECT = "proj_app";
  const OWN = "__nextgen_session_proj_app";
  const OPTIONS: ResolveSessionOptions = {
    url: "http://auth.test",
    projectId: PROJECT,
    allowedAlgorithms: ["RS256"],
    clockSkewMs: 0,
    audience: undefined,
    allowedTokenTypes: ["JWT"],
    jwksTimeoutMs: 1000,
    opaqueTokenTimeoutMs: 1000,
  };
  const SIGNED_OUT = { isAuthenticated: false, session: null };

  function request(
    cookies: Record<string, string>,
    bearer: string | null = null,
    requestUrl = "http://localhost:3000/",
  ) {
    return { bearer, cookie: (name: string) => cookies[name], requestUrl };
  }

  function backend(response: () => Response) {
    const fetchMock = vi.fn(async () => response());
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    clearJwksCache();
  });

  it("reads the project's own cookie before the server's", async () => {
    const fetchMock = backend(() => Response.json({ project_id: PROJECT, user_id: "u1" }));

    const resolved = await resolveSession(
      request({ [OWN]: "mine", [SERVER_SESSION_COOKIE]: "console" }),
      OPTIONS,
    );

    expect(resolved.auth).toMatchObject({ isAuthenticated: true, session: { token: "mine" } });
    expect(resolved.cookies).toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ headers: { cookie: "__nextgen_session=mine" } }),
    );
  });

  it("moves this project's session out of the server's cookie", async () => {
    const expiresAt = new Date(Date.now() + 600_000).toISOString();
    backend(() => Response.json({ project_id: PROJECT, user_id: "u1", expires_at: expiresAt }));

    const resolved = await resolveSession(request({ [SERVER_SESSION_COOKIE]: "old" }), OPTIONS);

    expect(resolved.auth.isAuthenticated).toBe(true);
    expect(resolved.cookies).toEqual([
      { name: OWN, value: "old", maxAge: expect.any(Number), secure: false },
      { name: SERVER_SESSION_COOKIE, value: "", maxAge: 0, secure: false },
    ]);
    expect(resolved.cookies[0]?.maxAge).toBeGreaterThan(590);
  });

  it("leaves another project's session in the server's cookie", async () => {
    backend(() => Response.json({ code: "sess.project_mismatch" }, { status: 403 }));

    const resolved = await resolveSession(request({ [SERVER_SESSION_COOKIE]: "console" }), OPTIONS);

    expect(resolved).toEqual({ auth: SIGNED_OUT, cookies: [] });
  });

  it.each([
    [
      "the project's own cookie",
      { [OWN]: "dead", [SERVER_SESSION_COOKIE]: "console", __nextgen_session_proj_other: "x" },
      OWN,
    ],
    [
      "the server's cookie",
      { [SERVER_SESSION_COOKIE]: "dead", __nextgen_session_proj_other: "x" },
      SERVER_SESSION_COOKIE,
    ],
  ])("clears only %s when it holds a dead session", async (_label, cookies, cleared) => {
    backend(() => new Response(null, { status: 401 }));

    const resolved = await resolveSession(request(cookies), OPTIONS);

    expect(resolved.cookies).toEqual([{ name: cleared, value: "", maxAge: 0, secure: false }]);
  });

  it("ignores another app's session cookie", async () => {
    const fetchMock = backend(() => Response.json({}));

    const resolved = await resolveSession(
      request({ __nextgen_session_proj_other: "other" }),
      OPTIONS,
    );

    expect(resolved).toEqual({ auth: SIGNED_OUT, cookies: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("clears with Secure where the app is served over https", async () => {
    backend(() => new Response(null, { status: 401 }));

    const resolved = await resolveSession(
      request({ [OWN]: "dead" }, null, "https://app.example.com/"),
      OPTIONS,
    );

    expect(resolved.cookies).toEqual([{ name: OWN, value: "", maxAge: 0, secure: true }]);
  });

  it("touches no cookie without a project", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const resolved = await resolveSession(request({ [OWN]: "x", [SERVER_SESSION_COOKIE]: "y" }), {
      ...OPTIONS,
      projectId: undefined,
    });

    expect(resolved).toEqual({ auth: SIGNED_OUT, cookies: [] });
  });

  describe("with JWTs", () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwk = {
      ...(publicKey.export({ format: "jwk" }) as Record<string, unknown>),
      kid: "k1",
      alg: "RS256",
      use: "sig",
    };

    function jwt(claims: Record<string, unknown> = {}): string {
      const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
      const signing = `${part({ alg: "RS256", typ: "JWT", kid: "k1" })}.${part({
        iss: OPTIONS.url,
        sub: "u1",
        aud: PROJECT,
        exp: Math.floor(Date.now() / 1000) + 600,
        ...claims,
      })}`;
      return `${signing}.${createSign("SHA256").update(signing).sign(privateKey).toString("base64url")}`;
    }

    it("moves a JWT of this project out of the server's cookie, for as long as it lives", async () => {
      backend(() => Response.json({ keys: [jwk] }));
      const token = jwt();

      const resolved = await resolveSession(request({ [SERVER_SESSION_COOKIE]: token }), OPTIONS);

      expect(resolved.auth).toMatchObject({ isAuthenticated: true, session: { token } });
      expect(resolved.cookies[0]).toMatchObject({ name: OWN, value: token });
      expect(resolved.cookies[0]?.maxAge).toBeGreaterThan(590);
      expect(resolved.cookies[1]).toEqual({
        name: SERVER_SESSION_COOKIE,
        value: "",
        maxAge: 0,
        secure: false,
      });
    });

    it("leaves the cookie alone behind a Bearer token that signs no one in", async () => {
      backend(() => Response.json({ keys: [jwk] }));

      const resolved = await resolveSession(
        request({ [OWN]: jwt() }, jwt({ aud: "proj_other" })),
        OPTIONS,
      );

      expect(resolved).toEqual({ auth: SIGNED_OUT, cookies: [] });
    });

    it("leaves a JWT cookie alone behind a Bearer token that fails", async () => {
      backend(() => Response.json({ keys: [jwk] }));

      const resolved = await resolveSession(request({ [OWN]: jwt() }, "not-a-jwt"), OPTIONS);

      expect(resolved.cookies).toEqual([]);
    });
  });
});
