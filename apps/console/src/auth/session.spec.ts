import {
  getApiCsrfRejectionHandler,
  getApiCsrfToken,
  setApiCsrfToken,
} from "@zitadel/api/runtime/auth";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetSessionForTesting,
  fetchSession,
  invalidateSessionCache,
  sessionPage,
} from "./session";
import { makeTestSession } from "./session.fixture";

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(() => {
  _resetSessionForTesting();
  vi.spyOn(sessionPage, "reload").mockImplementation(() => undefined);
});
afterEach(() => {
  server.resetHandlers();
  setApiCsrfToken(undefined);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/**
 * Answers GET /sessions/me with `user_id`, with a 401 when it is null, or with
 * a 502 for "unreachable".
 */
function stubSession(userId: string | null | "unreachable") {
  server.use(
    http.get("*/sessions/me", () => {
      if (userId === "unreachable") return HttpResponse.text("bad gateway", { status: 502 });
      return userId
        ? HttpResponse.json(makeTestSession({ user_id: userId }))
        : HttpResponse.json({ code: "auth.unauthorized", message: "no" }, { status: 401 });
    }),
  );
}

/** Answers GET /sessions/me with a session built from `overrides`. */
function stubSessionBody(overrides: Parameters<typeof makeTestSession>[0]) {
  server.use(http.get("*/sessions/me", () => HttpResponse.json(makeTestSession(overrides))));
}

/** Answers GET /sessions/me/csrf with `respond`; reports how often it was asked. */
function stubCsrf(respond: () => Response) {
  let calls = 0;
  server.use(
    http.get("*/sessions/me/csrf", () => {
      calls++;
      return respond();
    }),
  );
  return () => calls;
}

const token = (value: string) => () => HttpResponse.json({ csrf_token: value });
const failing = () => HttpResponse.json({ code: "internal", message: "no" }, { status: 500 });

/** Resolves false after the pending requests had their turn. */
const pending = () => new Promise<false>((resolve) => setTimeout(() => resolve(false), 50));

/** What customFetch does on a 403 auth.csrf_invalid: ask for a token to retry with. */
function rejectWrite(): Promise<string | undefined> {
  const onRejected = getApiCsrfRejectionHandler();
  if (!onRejected) throw new Error("session.ts registers the rejection handler");
  return onRejected();
}

describe("fetchSession", () => {
  it("returns the session and sets the CSRF token", async () => {
    stubSession("user_a");
    stubCsrf(token("tok"));

    expect(await fetchSession()).toMatchObject({ state: "active" });
    expect(getApiCsrfToken()).toBe("tok");
  });

  // Only the session decides whether someone is signed in: an old server
  // without /sessions/me/csrf, a proxy that does not forward it, or a transient
  // failure of just that read must not bounce a signed-in user to /login.
  it("keeps the user signed in when only the token read fails", async () => {
    stubSession("user_a");
    stubCsrf(failing);

    expect(await fetchSession()).toMatchObject({ state: "active" });
    expect(getApiCsrfToken()).toBeUndefined();
  });

  // A signed-out check (/login, the claim page, the 401 boundary) never asks
  // for a token it is certain not to get.
  it("reports no session on a 401, without asking for a token", async () => {
    stubSession(null);
    const calls = stubCsrf(failing);

    expect(await fetchSession()).toBeNull();
    expect(calls()).toBe(0);
  });

  // The token is stable for the life of a cookie: re-validating the session
  // after the cache window does not read it again, so a failing read there
  // cannot wipe a token that works.
  it("reads the token once, not on every re-validation", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    stubSession("user_a");
    const calls = stubCsrf(token("tok"));
    await fetchSession();

    vi.setSystemTime(Date.now() + 60_000);
    stubCsrf(failing);
    await fetchSession();

    expect(calls()).toBe(1);
    expect(getApiCsrfToken()).toBe("tok");
  });

  // Another tab signed in as someone else. Loading their token here would arm
  // this page's open forms to write as them, so the page starts over instead.
  it("starts over, without loading the new person's token, when someone else is signed in", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    stubSession("user_a");
    stubCsrf(token("tok_a"));
    await fetchSession();

    vi.setSystemTime(Date.now() + 60_000);
    stubSession("user_b");
    const calls = stubCsrf(token("tok_b"));
    // It never settles: answering null would send the guard to /login while
    // the reload is pending.
    const settled = await Promise.race([fetchSession().then(() => true), pending()]);

    expect(settled).toBe(false);
    expect(calls()).toBe(0);
    expect(getApiCsrfToken()).toBeUndefined();
    expect(sessionPage.reload).toHaveBeenCalledOnce();
  });

  // The person belongs to the document, so losing the session does not clear
  // it: the same person signing in again carries on, and anyone else means a
  // fresh document.
  describe.each([
    ["a 401", () => stubSession(null)],
    ["an anonymous session", () => stubSessionBody({ user_id: undefined })],
    ["an expired session", () => stubSessionBody({ user_id: "user_a", state: "expired" })],
  ] as const)("after %s", (_, loseSession) => {
    async function signInThenLose() {
      vi.useFakeTimers({ toFake: ["Date"] });
      stubSession("user_a");
      stubCsrf(token("tok_a"));
      await fetchSession();

      vi.setSystemTime(Date.now() + 60_000);
      loseSession();
      expect(await fetchSession()).toBeNull();
      // The token belonged to the lost session.
      expect(getApiCsrfToken()).toBeUndefined();
    }

    it("carries on when the same person signs in again", async () => {
      await signInThenLose();
      stubSession("user_a");
      stubCsrf(token("tok_a2"));

      expect(await fetchSession()).toMatchObject({ user_id: "user_a" });
      expect(getApiCsrfToken()).toBe("tok_a2");
      expect(sessionPage.reload).not.toHaveBeenCalled();
    });

    it("starts over when someone else signs in", async () => {
      await signInThenLose();
      stubSession("user_b");
      const calls = stubCsrf(token("tok_b"));

      void fetchSession();
      await vi.waitFor(() => expect(sessionPage.reload).toHaveBeenCalledOnce());
      expect(calls()).toBe(0);
      expect(getApiCsrfToken()).toBeUndefined();
    });
  });

  // The 401 boundary drops the cache to read the session afresh; that must not
  // drop the person with it, or the boundary would adopt someone else in place.
  it("starts over after a cache drop when someone else is signed in", async () => {
    stubSession("user_a");
    stubCsrf(token("tok_a"));
    await fetchSession();

    invalidateSessionCache();
    stubSession("user_b");
    void fetchSession();

    await vi.waitFor(() => expect(sessionPage.reload).toHaveBeenCalledOnce());
    expect(getApiCsrfToken()).toBeUndefined();
  });

  it("keeps the person when the session cannot be read", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    stubSession("user_a");
    stubCsrf(token("tok_a"));
    await fetchSession();

    vi.setSystemTime(Date.now() + 60_000);
    stubSession("unreachable");
    expect(await fetchSession()).toBeNull();
    expect(getApiCsrfToken()).toBe("tok_a");

    stubSession("user_b");
    void fetchSession();
    await vi.waitFor(() => expect(sessionPage.reload).toHaveBeenCalledOnce());
  });
});

describe("CSRF rejection", () => {
  it("hands back a fresh token when the same person is still signed in", async () => {
    stubSession("user_a");
    stubCsrf(failing);
    await fetchSession();
    expect(getApiCsrfToken()).toBeUndefined();

    stubCsrf(token("tok"));
    // The token comes back, so customFetch retries the write once with it.
    expect(await rejectWrite()).toBe("tok");

    expect(getApiCsrfToken()).toBe("tok");
    expect(sessionPage.reload).not.toHaveBeenCalled();
  });

  // Another tab signed in as someone else: the refused write is not replayed
  // under that session, and the page, which still shows the first person,
  // starts over with everything cached for them dropped.
  it("starts over when someone else is signed in now", async () => {
    stubSession("user_a");
    stubCsrf(token("tok_a"));
    await fetchSession();

    stubSession("user_b");
    stubCsrf(token("tok_b"));
    // Nothing to retry with: the write is not replayed as user_b.
    expect(await rejectWrite()).toBeUndefined();

    expect(sessionPage.reload).toHaveBeenCalledOnce();
    expect(getApiCsrfToken()).toBeUndefined();
  });

  it("starts over when nobody is signed in any more", async () => {
    stubSession("user_a");
    stubCsrf(token("tok_a"));
    await fetchSession();

    stubSession(null);
    expect(await rejectWrite()).toBeUndefined();

    expect(sessionPage.reload).toHaveBeenCalledOnce();
    expect(getApiCsrfToken()).toBeUndefined();
  });

  // A network blip on the re-check must not cost the person their page: the
  // write stays refused for them to retry, and nothing else changes.
  it("keeps the page when the session cannot be read", async () => {
    stubSession("user_a");
    stubCsrf(token("tok_a"));
    await fetchSession();

    stubSession("unreachable");
    expect(await rejectWrite()).toBeUndefined();

    expect(sessionPage.reload).not.toHaveBeenCalled();
    expect(getApiCsrfToken()).toBe("tok_a");
  });

  // Without a recorded person there is nothing to compare the session to, so
  // no token is handed back and nothing is retried.
  it("does not retry when this page has no person yet", async () => {
    stubSession("user_b");
    stubCsrf(token("tok_b"));

    expect(await rejectWrite()).toBeUndefined();
    expect(getApiCsrfToken()).toBeUndefined();
    expect(sessionPage.reload).not.toHaveBeenCalled();
  });

  // A navigation's fetchSession can see the other person first and start over
  // while the re-check is still reading: the page reloads once, not twice.
  it("leaves a start-over that happened meanwhile alone", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    stubSession("user_a");
    stubCsrf(token("tok_a"));
    await fetchSession();

    vi.setSystemTime(Date.now() + 60_000);
    let answer!: () => void;
    const held = new Promise<void>((resolve) => (answer = resolve));
    let reads = 0;
    server.use(
      http.get("*/sessions/me", async () => {
        // The re-check's read is held until fetchSession has started over.
        if (reads++ === 0) await held;
        return HttpResponse.json(makeTestSession({ user_id: "user_b" }));
      }),
    );
    stubCsrf(token("tok_b"));

    const rejected = rejectWrite();
    void fetchSession();
    await vi.waitFor(() => expect(sessionPage.reload).toHaveBeenCalledOnce());
    answer();

    expect(await rejected).toBeUndefined();
    expect(sessionPage.reload).toHaveBeenCalledOnce();
    expect(getApiCsrfToken()).toBeUndefined();
  });
});
