import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RUNTIME_URL,
  _resetRuntimeForTesting,
  getConsoleProjectId,
  getPublishableKey,
  getRuntime,
  initRuntime,
  retryRuntime,
} from "./runtime";

/**
 * Console runtime discovery (Console ADR 0004 §3): the document is fetched
 * once, an unreachable or erroring endpoint is reported as a failure rather
 * than guessed to be `standalone`, `VITE_CONSOLE_RUNTIME_FALLBACK` is the
 * backend-less opt-in back to that fallback, and the dev env override wins
 * over the discovered project id.
 */
const fetchMock = vi.fn();

beforeEach(() => {
  _resetRuntimeForTesting();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  // Re-applied per test: `unstubAllEnvs` below drops `test-setup.ts`'s
  // hermetic defaults along with each test's own stubs.
  vi.stubEnv("VITE_CONSOLE_PROJECT_ID", "");
  vi.stubEnv("VITE_CONSOLE_RUNTIME_FALLBACK", "");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown, init?: { ok?: boolean; status?: number }): Response {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? (init?.ok === false ? 500 : 200),
    json: async () => body,
  } as Response;
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

    const result = await initRuntime();

    expect(fetchMock).toHaveBeenCalledWith(RUNTIME_URL, { credentials: "same-origin" });
    expect(result).toEqual({
      ok: true,
      runtime: {
        mode: "standalone",
        console_project_id: "proj_first",
        publishable_key: "pk_test",
      },
    });
    expect(getPublishableKey()).toBe("pk_test");

    // Idempotent: a second call returns the cache without refetching.
    await initRuntime();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats a 2xx document without a project as awaiting setup, not an error", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ mode: "standalone" }));

    const result = await initRuntime();

    expect(result).toEqual({ ok: true, runtime: { mode: "standalone" } });
    // The login screen renders its `zitadel setup` hint off this empty id.
    expect(getConsoleProjectId()).toBe("");
  });

  it("reports an unreachable endpoint as a failure", async () => {
    fetchMock.mockRejectedValue(new TypeError("network down"));

    expect(await initRuntime()).toEqual({
      ok: false,
      failure: { detail: "the request failed (network down)" },
    });
  });

  it("reports a non-2xx response as a failure carrying the status", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, { ok: false, status: 500 }));

    expect(await initRuntime()).toEqual({
      ok: false,
      failure: { status: 500, detail: "the server answered 500" },
    });
  });

  it("reports an unparseable body as a failure", async () => {
    // What a dev server answers for an unknown path: 200 with `index.html`.
    fetchMock.mockResolvedValue({
      ...jsonResponse(null),
      json: async () => {
        throw new SyntaxError("Unexpected token <");
      },
    });

    expect(await initRuntime()).toEqual({
      ok: false,
      failure: { status: 200, detail: "the response was not valid JSON" },
    });
  });

  it("reports a document with an unknown mode as a failure", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ mode: "enterprise", console_project_id: "x" }));

    expect(await initRuntime()).toEqual({
      ok: false,
      failure: { status: 200, detail: "the response was not a runtime document" },
    });
  });

  // A wrongly-typed id must not coerce to "absent" and render as "no project
  // yet": the server omits the ids it has none of (`omitempty`), so a present
  // one that is not a usable string came from something that is not our
  // server. Same misdiagnosis §3 removes, one field lower down.
  it.each([
    ["console_project_id", { mode: "standalone", console_project_id: 42 }],
    ["publishable_key", { mode: "standalone", console_project_id: "proj_a", publishable_key: 42 }],
    ["a null id", { mode: "standalone", console_project_id: null }],
    ["an empty id", { mode: "standalone", console_project_id: "" }],
  ])("reports a malformed %s as a failure rather than an absent project", async (_case, doc) => {
    fetchMock.mockResolvedValue(jsonResponse(doc));

    expect(await initRuntime()).toEqual({
      ok: false,
      failure: { status: 200, detail: "the response was not a runtime document" },
    });
  });

  it("shares one in-flight fetch across concurrent callers", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ mode: "standalone", console_project_id: "proj_a" }));

    const [first, second] = await Promise.all([initRuntime(), initRuntime()]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
  });
});

describe("VITE_CONSOLE_RUNTIME_FALLBACK", () => {
  it("degrades a failed discovery to the standalone document when opted in", async () => {
    vi.stubEnv("VITE_CONSOLE_RUNTIME_FALLBACK", "1");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    fetchMock.mockResolvedValue(jsonResponse({}, { ok: false, status: 404 }));

    expect(await initRuntime()).toEqual({ ok: true, runtime: { mode: "standalone" } });
    // The opt-in is never silent — a build carrying the flag says so.
    expect(warn).toHaveBeenCalledOnce();
  });

  it("stays off for values that read as disabled", async () => {
    vi.stubEnv("VITE_CONSOLE_RUNTIME_FALLBACK", "false");
    fetchMock.mockRejectedValue(new TypeError("network down"));

    expect(await initRuntime()).toMatchObject({ ok: false });
  });
});

describe("retryRuntime", () => {
  it("re-fetches after a failure and keeps the document once one arrives", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("network down"));
    expect(await initRuntime()).toMatchObject({ ok: false });

    fetchMock.mockResolvedValue(jsonResponse({ mode: "standalone", console_project_id: "proj_up" }));

    expect(await retryRuntime()).toEqual({
      ok: true,
      runtime: { mode: "standalone", console_project_id: "proj_up" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // A resolved document is a per-boot fact: retrying again must not refetch
    // and swap the sign-in project under a mounted router.
    expect(await retryRuntime()).toMatchObject({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
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

  it("resolves to an empty id before discovery", () => {
    vi.stubEnv("VITE_CONSOLE_PROJECT_ID", "");
    expect(getRuntime()).toEqual({ mode: "standalone" });
    expect(getConsoleProjectId()).toBe("");
  });
});
