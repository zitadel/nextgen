import { describe, expect, it } from "vitest";

import { filterResponseHeaders } from "./middleware.js";

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
