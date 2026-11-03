/**
 * How the Next.js middleware writes session cookies, beyond the contract every
 * server SDK shares: through the response's cookie jar, so a middleware composed
 * around it that sets a cookie of its own keeps them.
 */

import { NextRequest, type NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearSessionCheckCache } from "@zitadel/sdk-core/middleware";

import { nextgenMiddleware } from "../middleware";

const PROJECT = "proj_app";
const SESSION = `zitadel_session_${PROJECT}`;

/**
 * The middleware's answer for a request that carries this project's session
 * under the shared name, on a protected route: only there does it ask about an
 * opaque session.
 */
async function copied(path: string): Promise<NextResponse> {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ project_id: PROJECT, user_id: "u1" })),
  );
  const request = new NextRequest(`http://localhost:3000${path}`, {
    headers: { cookie: "zitadel_session=tok" },
  });
  return (await nextgenMiddleware(request, {
    url: "http://localhost:4000",
    projectId: PROJECT,
    protectedRoutes: [path],
  })) as NextResponse;
}

describe("session cookies in Next's response cookie jar", () => {
  beforeEach(() => {
    clearSessionCheckCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the copied session cookie when a composed middleware sets a cookie of its own", async () => {
    const response = await copied("/profile");

    response.cookies.set("locale", "en");

    const setCookies = response.headers.getSetCookie();
    expect(setCookies.some((cookie) => cookie.startsWith(`${SESSION}=tok;`))).toBe(true);
    expect(setCookies.some((cookie) => cookie.startsWith("locale=en"))).toBe(true);
  });

  it("lists the copied session cookie in the jar", async () => {
    const response = await copied("/profile");

    expect(response.cookies.get(SESSION)?.value).toBe("tok");
  });
});
