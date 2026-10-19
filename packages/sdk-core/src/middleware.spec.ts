import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HOP_BY_HOP,
  filterResponseHeaders,
  matchesRoutes,
  jwtNamesProject,
  requiresProjectSecret,
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
