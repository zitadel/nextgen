import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RUNTIME_URL,
  _resetRuntimeForTesting,
  getConsoleProjectId,
  getPublishableKey,
  getRuntime,
  initRuntime,
} from "./runtime";

/**
 * Console runtime discovery (Console ADR 0004 §3): the document is fetched
 * once, malformed or unreachable endpoints degrade to the standalone
 * fallback, and the dev env override wins over the discovered project id.
 */
const fetchMock = vi.fn();

beforeEach(() => {
  _resetRuntimeForTesting();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as Response;
}

describe("initRuntime", () => {
  it("parses the served document and caches it", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        mode: "standalone",
        console_project_id: "proj_first",
        publishable_key: "pk_test",
      }),
    );

    const runtime = await initRuntime();

    expect(fetchMock).toHaveBeenCalledWith(RUNTIME_URL, { credentials: "same-origin" });
    expect(runtime).toEqual({
      mode: "standalone",
      console_project_id: "proj_first",
      publishable_key: "pk_test",
    });
    expect(getPublishableKey()).toBe("pk_test");

    // Idempotent: a second call returns the cache without refetching.
    await initRuntime();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to standalone when the endpoint is unreachable", async () => {
    fetchMock.mockRejectedValue(new TypeError("network down"));

    expect(await initRuntime()).toEqual({ mode: "standalone" });
  });

  it("falls back to standalone on a non-OK response", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, false));

    expect(await initRuntime()).toEqual({ mode: "standalone" });
  });

  it("rejects a document with an unknown mode", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ mode: "enterprise", console_project_id: "x" }));

    expect(await initRuntime()).toEqual({ mode: "standalone" });
  });
});

describe("getConsoleProjectId", () => {
  it("prefers the VITE_CONSOLE_PROJECT_ID dev override", async () => {
    vi.stubEnv("VITE_CONSOLE_PROJECT_ID", "proj_env");
    fetchMock.mockResolvedValue(
      jsonResponse({ mode: "standalone", console_project_id: "proj_discovered" }),
    );
    await initRuntime();

    expect(getConsoleProjectId()).toBe("proj_env");
  });

  it("uses the discovered console project id when no override is set", async () => {
    vi.stubEnv("VITE_CONSOLE_PROJECT_ID", "");
    fetchMock.mockResolvedValue(
      jsonResponse({ mode: "standalone", console_project_id: "proj_discovered" }),
    );
    await initRuntime();

    expect(getConsoleProjectId()).toBe("proj_discovered");
  });

  it("resolves to an empty id before discovery and after fallback", () => {
    vi.stubEnv("VITE_CONSOLE_PROJECT_ID", "");
    expect(getRuntime()).toEqual({ mode: "standalone" });
    expect(getConsoleProjectId()).toBe("");
  });
});
