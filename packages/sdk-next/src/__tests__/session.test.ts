import { _resetConfigForTesting, configureZitadel } from "@zitadel/api/config";
import type { GetSessionOptions as CoreGetSessionOptions } from "@zitadel/sdk-core/session";

import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import type { GetSessionOptions } from "../session";

import { getSession } from "../session";

// The read itself (status mapping, proxy path, project checks) is tested in
// @zitadel/sdk-core's session.spec.ts; these cases cover the Next.js glue.

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
  // The project the app signs its users in to, as Next.js inlines it.
  vi.stubEnv("NEXT_PUBLIC_ZITADEL_PROJECT_ID", "proj-1");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  _resetConfigForTesting();
});

describe("getSession()", () => {
  it("reads the session of the NEXT_PUBLIC_ZITADEL_PROJECT_ID project", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ session_id: "s", project_id: "proj-1", user_id: "user-1" }),
    );

    const result = await getSession();

    expect(fetchMock).toHaveBeenCalledWith(
      "/__nextgen/api/v1/sessions/me?project_id=proj-1",
      expect.objectContaining({ cache: "no-store", credentials: "include" }),
    );
    expect(result).toMatchObject({ isAuthenticated: true, session: { userId: "user-1" } });
  });

  it("prefers the configureZitadel() project over the environment", async () => {
    configureZitadel({ projectId: "proj-configured", proxyPath: "/configured" });
    fetchMock.mockResolvedValue(jsonResponse({ project_id: "proj-configured", user_id: "u" }));

    await getSession();

    expect(fetchMock).toHaveBeenCalledWith(
      "/configured/api/v1/sessions/me?project_id=proj-configured",
      expect.anything(),
    );
  });

  it("prefers explicit options over the configured project and proxy path", async () => {
    configureZitadel({ projectId: "proj-configured", proxyPath: "/configured" });
    fetchMock.mockResolvedValue(jsonResponse({ project_id: "proj-explicit", user_id: "u" }));

    await getSession({ projectId: "proj-explicit", proxyPath: "/explicit" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/explicit/api/v1/sessions/me?project_id=proj-explicit",
      expect.anything(),
    );
  });

  // As on the server, a session that cannot be held to a project signs no one
  // in: without a project, another project's session would read as this app's.
  it("reads as signed out, without asking the server, when no project is known", async () => {
    vi.stubEnv("NEXT_PUBLIC_ZITADEL_PROJECT_ID", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(getSession()).resolves.toEqual({ isAuthenticated: false, session: null });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("NEXT_PUBLIC_ZITADEL_PROJECT_ID"));
    warn.mockRestore();
  });

  it("refuses to run server-side and points at auth()", async () => {
    vi.stubGlobal("window", undefined);

    await expect(getSession()).rejects.toThrow(/auth\(\)/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("GetSessionOptions", () => {
  it("is the type of @zitadel/sdk-core", () => {
    expectTypeOf<GetSessionOptions>().toEqualTypeOf<CoreGetSessionOptions>();
  });
});
