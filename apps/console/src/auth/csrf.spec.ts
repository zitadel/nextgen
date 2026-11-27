import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { CSRF_HEADER, SessionCsrf } from "./csrf";
import { server } from "@/test/msw";

const API = "http://api.test";
const OTHER = "http://other.test";

const refused = () =>
  HttpResponse.json({ code: "auth.csrf_invalid", message: "refused" }, { status: 403 });
const created = () => HttpResponse.json({ id: "team_1" }, { status: 201 });

/**
 * Answers every request to `origin` with the next of `answers`, then `204`,
 * and records the CSRF header each one carried.
 */
function answering(origin: string, answers: Array<() => Response> = []): Array<string | null> {
  const sent: Array<string | null> = [];
  server.use(
    http.all(`${origin}/*`, ({ request }) => {
      sent.push(request.headers.get(CSRF_HEADER));
      return (answers.shift() ?? (() => new HttpResponse(null, { status: 204 })))();
    }),
  );
  return sent;
}

/** A `SessionCsrf` for {@link API} holding `token`, re-checking to `fresh`. */
function sessionCsrf(token: string | undefined, fresh?: string) {
  const csrf = new SessionCsrf(API);
  if (token) {
    csrf.remember(token);
  }
  const counted = { rechecks: 0 };
  csrf.recheckWith(async () => {
    counted.rechecks += 1;
    return fresh;
  });
  return { csrf, counted };
}

describe("SessionCsrf.fetch header", () => {
  it("sends the token on unsafe methods", async () => {
    const sent = answering(API);
    const { csrf } = sessionCsrf("tok");

    for (const method of ["POST", "PATCH", "DELETE", "put"]) {
      await csrf.fetch(`${API}/x`, { method });
    }

    expect(sent).toEqual(["tok", "tok", "tok", "tok"]);
  });

  it("leaves safe methods alone", async () => {
    const sent = answering(API);
    const { csrf } = sessionCsrf("tok");

    await csrf.fetch(`${API}/x`);
    await csrf.fetch(`${API}/x`, { method: "GET" });

    expect(sent).toEqual([null, null]);
  });

  it("adds nothing before a token is loaded", async () => {
    const sent = answering(API);

    await sessionCsrf(undefined).csrf.fetch(`${API}/x`, { method: "POST" });

    expect(sent).toEqual([null]);
  });

  it("sends the token only to the origin that issued it", async () => {
    const other = answering(OTHER);
    const { csrf } = sessionCsrf("tok");

    await csrf.fetch(`${OTHER}/x`, { method: "POST" });

    expect(other).toEqual([null]);
  });

  it("reads the token remembered now", async () => {
    const sent = answering(API);
    const { csrf } = sessionCsrf("first");

    await csrf.fetch(`${API}/x`, { method: "POST" });
    csrf.remember("second");
    await csrf.fetch(`${API}/x`, { method: "POST" });
    csrf.forget();
    await csrf.fetch(`${API}/x`, { method: "POST" });

    expect(sent).toEqual(["first", "second", null]);
  });

  it("keeps a header the caller set itself", async () => {
    const sent = answering(API);

    await sessionCsrf("tok").csrf.fetch(`${API}/x`, {
      method: "POST",
      headers: { [CSRF_HEADER]: "own" },
    });

    expect(sent).toEqual(["own"]);
  });
});

describe("SessionCsrf.fetch refusal", () => {
  it("retries once with the token the re-check hands back", async () => {
    const sent = answering(API, [refused, created]);
    const { csrf } = sessionCsrf("stale", "fresh");

    const res = await csrf.fetch(`${API}/teams`, { method: "POST", body: "{}" });

    expect(res.status).toBe(201);
    expect(sent).toEqual(["stale", "fresh"]);
  });

  it("recovers a write that went out without a token", async () => {
    const sent = answering(API, [refused, created]);

    const res = await sessionCsrf(undefined, "fresh").csrf.fetch(`${API}/teams`, {
      method: "POST",
    });

    expect(res.status).toBe(201);
    expect(sent).toEqual([null, "fresh"]);
  });

  // The re-check hands back nothing when someone else, or nobody, is signed in
  // now: the write is not replayed under a session it was not prepared for.
  it("does not retry when the re-check hands back no token", async () => {
    const sent = answering(API, [refused]);

    const res = await sessionCsrf("stale").csrf.fetch(`${API}/teams`, { method: "POST" });

    expect(res.status).toBe(403);
    expect(sent).toEqual(["stale"]);
  });

  it("does not retry with the token it was just refused with", async () => {
    const sent = answering(API, [refused, created]);

    const res = await sessionCsrf("same", "same").csrf.fetch(`${API}/teams`, { method: "POST" });

    expect(res.status).toBe(403);
    expect(sent).toEqual(["same"]);
  });

  it("retries at most once", async () => {
    const sent = answering(API, [refused, refused]);
    const { csrf, counted } = sessionCsrf("stale", "fresh");

    const res = await csrf.fetch(`${API}/teams`, { method: "POST" });

    expect(res.status).toBe(403);
    expect(sent).toEqual(["stale", "fresh"]);
    expect(counted.rechecks).toBe(1);
  });

  it("does not retry a body that can be read only once", async () => {
    const sent = answering(API, [refused]);
    const { csrf, counted } = sessionCsrf("stale", "fresh");

    await csrf.fetch(`${API}/teams`, {
      method: "POST",
      body: new ReadableStream({ start: (controller) => controller.close() }),
      duplex: "half",
    } as RequestInit);

    expect(counted.rechecks).toBe(0);
    expect(sent).toEqual(["stale"]);
  });

  it("leaves other 403 answers and safe methods alone", async () => {
    answering(API, [
      () => HttpResponse.json({ code: "team.permission_denied" }, { status: 403 }),
      refused,
    ]);
    const { csrf, counted } = sessionCsrf("tok", "fresh");

    await csrf.fetch(`${API}/teams`, { method: "POST" });
    await csrf.fetch(`${API}/teams`, { method: "GET" });

    expect(counted.rechecks).toBe(0);
  });
});
