import { describe, expect, it } from "vitest";

import { filterResponseHeaders } from "./middleware.js";

/** The upstream response headers for one proxied call. */
function upstream(entries: Record<string, string>): Headers {
  return new Headers(entries);
}

const APP = "https://app.example.com";
/** The callback the provider returns the browser to. */
const CALLBACK = `${APP}/__nextgen/idp/callback?code=abc`;

describe("filterResponseHeaders", () => {
  it("forwards a same-origin redirect", () => {
    // The identity-provider callback answers `302` back to the page the
    // sign-in started on. It is a top-level navigation with no JavaScript in
    // the loop, so dropping this header leaves the browser on an empty page.
    const filtered = filterResponseHeaders(
      upstream({ location: `${APP}/login?flow=flow_123` }),
      APP,
    );

    expect(filtered.get("location")).toBe(`${APP}/login?flow=flow_123`);
  });

  it("makes a relative redirect absolute, because Next rejects a relative one", () => {
    // A `Location` that is only a path fails with ERR_INVALID_URL when it
    // comes back from Next middleware, so the resolved form is forwarded.
    expect(
      filterResponseHeaders(upstream({ location: "/login?flow=x" }), APP).get("location"),
    ).toBe(`${APP}/login?flow=x`);
  });

  it("resolves a path-relative redirect against the request, not the origin root", () => {
    // RFC 3986 §5: a relative reference resolves against the URL it came from.
    // `next?flow=x` answered to `/__nextgen/idp/callback` means a sibling of
    // that path, and resolving from `/` would silently send the browser
    // somewhere else on the same origin.
    const filtered = filterResponseHeaders(upstream({ location: "next?flow=x" }), CALLBACK);

    expect(filtered.get("location")).toBe(`${APP}/__nextgen/idp/next?flow=x`);
  });

  it("keeps a query-only reference on the same path", () => {
    const filtered = filterResponseHeaders(upstream({ location: "?flow=x" }), CALLBACK);

    expect(filtered.get("location")).toBe(`${APP}/__nextgen/idp/callback?flow=x`);
  });

  it("still refuses another origin when resolved from a path", () => {
    for (const location of ["https://evil.com/x", "//evil.com/x"]) {
      expect(
        filterResponseHeaders(upstream({ location }), CALLBACK).has("location"),
        location,
      ).toBe(false);
    }
  });

  it("drops a redirect naming the upstream server", () => {
    // The whole point of the original strip: an internal hostname must never
    // reach the browser.
    const filtered = filterResponseHeaders(
      upstream({ location: "http://zitadel.internal:8080/flow/abc" }),
      APP,
    );

    expect(filtered.has("location")).toBe(false);
  });

  it("drops a redirect to another origin, including the protocol-relative form", () => {
    // `//evil.com/x` resolves against the app's own origin to another origin,
    // which is exactly the open-redirect shape this has to refuse.
    for (const location of ["https://evil.com/x", "//evil.com/x"]) {
      expect(filterResponseHeaders(upstream({ location }), APP).has("location"), location).toBe(
        false,
      );
    }
  });

  it("drops a redirect when the caller names no origin", () => {
    // A caller that cannot say what it is gets the old behaviour, so nothing
    // is forwarded on a guess.
    expect(filterResponseHeaders(upstream({ location: `${APP}/login` })).has("location")).toBe(
      false,
    );
  });

  it("drops a location that is not a URL at all", () => {
    expect(filterResponseHeaders(upstream({ location: "http://[" }), APP).has("location")).toBe(
      false,
    );
  });

  it("still strips set-cookie and hop-by-hop headers, and keeps the rest", () => {
    const filtered = filterResponseHeaders(
      upstream({
        "content-type": "application/json",
        "set-cookie": "a=1",
        connection: "keep-alive",
      }),
      APP,
    );

    expect(filtered.get("content-type")).toBe("application/json");
    expect(filtered.has("set-cookie")).toBe(false);
    expect(filtered.has("connection")).toBe(false);
  });
});
