import { _resetConfigForTesting, configureZitadel } from "@zitadel/api/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _resetSessionStoresForTesting, sessionStore } from "./session.js";

// What a single read maps a response to is tested in session.spec.ts; these
// cases cover sharing, ordering, lifetime and the snapshot contract.

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const signedIn = () =>
  jsonResponse({ project_id: "proj-1", user_id: "user-1", user: { display: "Bob" } });
const signedOut = () => jsonResponse({ code: "auth.unauthorized", message: "No session" }, 401);
const broken = () => jsonResponse({ error: "boom" }, 502);

const fetchMock = vi.fn<typeof fetch>();
/** Lets queued microtasks and settled promises run. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  _resetConfigForTesting();
  _resetSessionStoresForTesting();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("window", {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  _resetConfigForTesting();
});

describe("sessionStore()", () => {
  it("reads nothing until something subscribes, then publishes the answer", async () => {
    fetchMock.mockResolvedValue(signedIn());
    const store = sessionStore({ projectId: "proj-1" });

    expect(store.getSnapshot().status).toBe("loading");
    expect(fetchMock).not.toHaveBeenCalled();

    const listener = vi.fn();
    store.subscribe(listener);
    await flush();

    expect(store.getSnapshot()).toEqual({
      status: "authenticated",
      session: { userId: "user-1", identifier: null, identifierProperty: null, display: "Bob" },
      error: null,
      isRefreshing: false,
    });
    expect(listener).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns one handle and shares one read for options that resolve alike", async () => {
    configureZitadel({ projectId: "proj-1" });
    fetchMock.mockResolvedValue(signedIn());

    const bare = sessionStore();
    const explicit = sessionStore({ projectId: "proj-1", proxyPath: "/__nextgen/" });
    bare.subscribe(() => {});
    explicit.subscribe(() => {});
    await flush();

    expect(bare).toBe(explicit);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports a missing project as error session.no_project, not signed out", async () => {
    const store = sessionStore();

    await expect(store.settled()).resolves.toMatchObject({
      status: "error",
      error: { code: "session.no_project" },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a failed first read as error session.read_failed", async () => {
    fetchMock.mockResolvedValue(broken());

    const snapshot = await sessionStore({ projectId: "proj-1" }).settled();

    expect(snapshot).toMatchObject({ status: "error", session: null });
    expect(snapshot.error).toEqual({
      code: "session.read_failed",
      message: expect.stringContaining("HTTP 502"),
    });
  });

  it("refresh() resolves with the new snapshot and flags isRefreshing while it runs", async () => {
    fetchMock.mockResolvedValueOnce(signedIn()).mockResolvedValueOnce(signedOut());
    const store = sessionStore({ projectId: "proj-1" });
    store.subscribe(() => {});
    await flush();

    const refreshing = store.refresh();
    expect(store.getSnapshot()).toMatchObject({ status: "authenticated", isRefreshing: true });

    await expect(refreshing).resolves.toEqual({
      status: "unauthenticated",
      session: null,
      error: null,
      isRefreshing: false,
    });
  });

  it("keeps the last answer when a refresh fails, and reports the failure beside it", async () => {
    fetchMock.mockResolvedValueOnce(signedIn()).mockResolvedValueOnce(broken());
    const store = sessionStore({ projectId: "proj-1" });
    store.subscribe(() => {});
    await flush();

    const snapshot = await store.refresh();

    expect(snapshot).toMatchObject({
      status: "authenticated",
      session: { userId: "user-1" },
      error: { code: "session.read_failed" },
      isRefreshing: false,
    });
  });

  it("resolves an overtaken refresh with the newest read's snapshot", async () => {
    let answerFirst: (response: Response) => void = () => {};
    fetchMock
      .mockResolvedValueOnce(signedIn())
      .mockReturnValueOnce(new Promise((resolve) => (answerFirst = resolve)))
      .mockResolvedValueOnce(signedOut());
    const store = sessionStore({ projectId: "proj-1" });
    store.subscribe(() => {});
    await flush();

    const first = store.refresh();
    const second = store.refresh();
    await second;
    answerFirst(signedIn());

    await expect(first).resolves.toMatchObject({ status: "unauthenticated" });
    expect(store.getSnapshot().status).toBe("unauthenticated");
  });

  it("settled() waits for the first answer without a subscriber", async () => {
    fetchMock.mockResolvedValue(signedIn());

    await expect(sessionStore({ projectId: "proj-1" }).settled()).resolves.toMatchObject({
      status: "authenticated",
    });
  });

  it("forgets the read once the last subscriber leaves, so a later one reads again", async () => {
    fetchMock.mockResolvedValueOnce(signedIn()).mockResolvedValueOnce(signedOut());
    const store = sessionStore({ projectId: "proj-1" });
    const unsubscribe = store.subscribe(() => {});
    await flush();
    unsubscribe();
    await flush();

    expect(store.getSnapshot().status).toBe("loading");
    store.subscribe(() => {});
    await flush();

    expect(store.getSnapshot().status).toBe("unauthenticated");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps the read when a subscriber leaves and comes straight back", async () => {
    fetchMock.mockResolvedValue(signedIn());
    const store = sessionStore({ projectId: "proj-1" });

    // React StrictMode's simulated unmount and remount.
    store.subscribe(() => {})();
    store.subscribe(() => {});
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stays loading and reads nothing on a server", async () => {
    vi.stubGlobal("window", undefined);
    const store = sessionStore({ projectId: "proj-1" });

    store.subscribe(() => {});
    expect(store.getSnapshot().status).toBe("loading");
    expect(store.getServerSnapshot().status).toBe("loading");
    await expect(store.refresh()).resolves.toMatchObject({ status: "loading" });
    await expect(store.settled()).resolves.toMatchObject({ status: "loading" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
