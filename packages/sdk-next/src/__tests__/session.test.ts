import { _resetConfigForTesting, configureZitadel } from "@zitadel/api/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getSession } from "../session";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  _resetConfigForTesting();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  _resetConfigForTesting();
});

describe("getSession()", () => {
  it("reads the default proxy path with credentials and maps the identity", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        session_id: "sess-1",
        project_id: "proj-1",
        state: "active",
        user_id: "user-1",
        email: "bob@example.com",
        name: "Bob",
      }),
    );

    const result = await getSession();

    expect(fetchMock).toHaveBeenCalledWith(
      "/__nextgen/sessions/me",
      expect.objectContaining({ credentials: "include" }),
    );
    expect(result).toEqual({
      isAuthenticated: true,
      session: { userId: "user-1", email: "bob@example.com", name: "Bob" },
    });
  });

  it("nulls absent identity attributes instead of dropping the session", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ session_id: "s", project_id: "p", state: "active", user_id: "user-2" }),
    );

    const result = await getSession();

    expect(result).toEqual({
      isAuthenticated: true,
      session: { userId: "user-2", email: null, name: null },
    });
  });

  it("treats an anonymous session (no user_id) as signed out", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ session_id: "s", project_id: "p", state: "building", user_id: null }),
    );

    await expect(getSession()).resolves.toEqual({ isAuthenticated: false, session: null });
  });

  it.each([401, 404])("treats HTTP %i as the server's definitive signed-out", async (status) => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "no session" }, status));

    await expect(getSession()).resolves.toEqual({ isAuthenticated: false, session: null });
  });

  it("throws on other failures instead of silently rendering signed-out", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "boom" }, 502));

    await expect(getSession()).rejects.toThrow(/HTTP 502/);
  });

  it("throws on a framework's HTML 404 — only the backend's JSON 404 means signed out", async () => {
    // A misrouted proxy (e.g. matcher miss) yields the router's 404 page,
    // not the backend's error details; that must be loud, not "signed out".
    fetchMock.mockResolvedValue(
      new Response("<!DOCTYPE html><h1>404</h1>", {
        status: 404,
        headers: { "content-type": "text/html" },
      }),
    );

    await expect(getSession()).rejects.toThrow(/HTTP 404/);
  });

  it("strips trailing slashes from the proxy path before building the URL", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ user_id: "u" }));

    await getSession({ proxyPath: "/__nextgen/" });

    expect(fetchMock).toHaveBeenCalledWith("/__nextgen/sessions/me", expect.anything());
  });

  it("prefers an explicit proxyPath over the configured one", async () => {
    configureZitadel({ projectId: "proj", proxyPath: "/configured" });
    fetchMock.mockResolvedValue(jsonResponse({ user_id: "u" }));

    await getSession({ proxyPath: "/explicit" });

    expect(fetchMock).toHaveBeenCalledWith("/explicit/sessions/me", expect.anything());
  });

  it("falls back to the configureZitadel() proxy path when set", async () => {
    configureZitadel({ projectId: "proj", proxyPath: "/configured" });
    fetchMock.mockResolvedValue(jsonResponse({ user_id: "u" }));

    await getSession();

    expect(fetchMock).toHaveBeenCalledWith("/configured/sessions/me", expect.anything());
  });

  it("refuses to run server-side and points at auth()", async () => {
    vi.stubGlobal("window", undefined);

    await expect(getSession()).rejects.toThrow(/auth\(\)/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
