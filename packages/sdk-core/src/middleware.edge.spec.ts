import { loginRedirectUrl, matchesRoutes } from "@zitadel/sdk-core/middleware";
import { describe, expect, it } from "vitest";

describe("the middleware entry in the edge runtime", () => {
  it("matches a protected route, with or without a trailing slash, and a wildcard prefix", () => {
    expect(matchesRoutes("/admin/", ["/admin"])).toBe(true);
    expect(matchesRoutes("/admin/users", ["/admin/*"])).toBe(true);
    expect(matchesRoutes("/administrator", ["/admin"])).toBe(false);
  });

  it("sends a signed-out request to the login path, naming the page to return to", () => {
    const url = loginRedirectUrl("/login", "http://localhost:3000/admin?tab=x");
    expect(`${url.pathname}${url.search}`).toBe("/login?next=%2Fadmin%3Ftab%3Dx");
  });
});
