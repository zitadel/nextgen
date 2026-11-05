/**
 * Where the Next.js middleware asks the backend about a session, beyond the
 * contract every server SDK shares: only on a protected route, the one place it
 * decides anything by the session. Elsewhere it hands an opaque session token
 * on to auth(), so a page that never reads the session costs no call to the
 * server (ADR 036).
 */

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearSessionCheckCache } from "@zitadel/sdk-core/middleware";

import { auth } from "../auth";
import { nextgenMiddleware } from "../middleware";

const mockHeaders = vi.hoisted(() => new Map<string, string>());

vi.mock("next/headers", () => ({
  headers: vi.fn(() => Promise.resolve({ get: (name: string) => mockHeaders.get(name) ?? null })),
}));

const PROJECT = "proj_app";
const OPTIONS = { url: "http://localhost:4000", projectId: PROJECT, protectedRoutes: ["/admin"] };

/** Answers the session probe for a live session of this project, and records each call. */
function sessionsMe(): string[] {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      calls.push(String(url));
      return Response.json({ project_id: PROJECT, user_id: "u1" });
    }),
  );
  return calls;
}

describe("session checks in the Next.js middleware", () => {
  beforeEach(() => {
    clearSessionCheckCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    mockHeaders.clear();
  });

  it("asks nothing about a session on a public page, and auth() signs its user in", async () => {
    const calls = sessionsMe();
    const request = new NextRequest("http://localhost:3000/cart", {
      headers: { cookie: `zitadel_session_${PROJECT}=opaque-session-token` },
    });

    const response = await nextgenMiddleware(request, OPTIONS);

    expect(calls).toEqual([]);
    const token = response.headers.get("x-middleware-request-x-nextgen-auth-token");
    expect(token).toBe("opaque-session-token");

    mockHeaders.set("x-nextgen-auth-token", token ?? "");
    expect(await auth(OPTIONS)).toMatchObject({ isAuthenticated: true, session: { userId: "u1" } });
    expect(calls).toEqual([`http://localhost:4000/api/v1/sessions/me?project_id=${PROJECT}`]);
  });
});
