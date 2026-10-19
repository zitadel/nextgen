import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  type AuditEvent,
  type AuditPage,
  readNewAuditEvents,
  SIGN_IN_EVENT_TYPES,
  signInEventOf,
  watchSignInAudit,
} from "../../../src/lib/sign-in-audit";

const audit = (event_type: string, overrides: Partial<AuditEvent> = {}): AuditEvent => ({
  id: `evt_${event_type}`,
  event_type,
  entity_id: "att_1",
  ...overrides,
});

describe("signInEventOf", () => {
  it.each([
    ["auth.attempt.created", "ceremony_started", "ok", false],
    ["auth.attempt.handed_off", "handed_off", "ok", false],
    ["auth.sso.authorization.failed", "callback_received", "failed", true],
    ["auth.sso.exchange.failed", "exchange_finished", "failed", true],
    ["auth.sso.exchange.succeeded", "exchange_finished", "ok", true],
  ])("reads %s as %s (%s), about an exchange: %s", (type, phase, status, isSso) => {
    const payload = isSso ? { connection_slug: "google" } : undefined;
    expect(signInEventOf(audit(type, { payload }), "google")).toMatchObject({
      slug: "google",
      phase,
      status,
      ...(isSso ? { sso: true } : {}),
    });
  });

  it("keeps when the event was recorded", () => {
    expect(
      signInEventOf(
        audit("auth.attempt.created", { occurred_at: "2026-10-19T00:00:00Z" }),
        "google",
      ),
    ).toMatchObject({ at: "2026-10-19T00:00:00Z" });
  });

  it("does not mark the start or the handoff of an attempt as about the connection", () => {
    expect([
      signInEventOf(audit("auth.attempt.created"), "google")?.sso,
      signInEventOf(audit("auth.attempt.handed_off"), "google")?.sso,
    ]).toEqual([undefined, undefined]);
  });

  it.each([undefined, ""])(
    "does not take an exchange that names no connection (%j) for this one's",
    (connection_slug) => {
      expect(
        signInEventOf(
          audit("auth.sso.exchange.succeeded", { payload: { connection_slug } }),
          "google",
        ),
      ).toBeUndefined();
    },
  );

  it("does not read a link created for a user as part of an attempt, since it names none", () => {
    expect(signInEventOf(audit("idp.identity_link.created"), "google")).toBeUndefined();
  });

  it("reads the phase of a failure after the exchange from its payload", () => {
    const event = audit("auth.sso.resolution.failed", {
      payload: {
        auth_attempt_id: "att_9",
        connection_slug: "google",
        phase: "handed_off",
        reason: "handoff_failed",
        side: "journey",
      },
    });

    expect(signInEventOf(event, "google")).toEqual({
      slug: "google",
      flowId: "att_9",
      sso: true,
      phase: "handed_off",
      status: "failed",
      reason: "handoff_failed",
      side: "journey",
    });
  });

  it("carries the reason and side a failed event names", () => {
    const event = audit("auth.sso.authorization.failed", {
      payload: {
        auth_attempt_id: "att_2",
        connection_slug: "google",
        reason: "provider_denied",
        side: "provider",
      },
    });

    expect(signInEventOf(event, "google")).toMatchObject({
      flowId: "att_2",
      reason: "provider_denied",
      side: "provider",
    });
  });

  it("names the attempt by the payload when the event is about a check, else by the entity", () => {
    expect([
      signInEventOf(
        audit("auth.sso.exchange.succeeded", {
          payload: { auth_attempt_id: "att_9", connection_slug: "g" },
        }),
        "g",
      )?.flowId,
      signInEventOf(audit("auth.attempt.created"), "g")?.flowId,
    ]).toEqual(["att_9", "att_1"]);
  });

  it("keeps an event of another connection under that connection, for the follower to tell", () => {
    const event = audit("auth.sso.exchange.succeeded", { payload: { connection_slug: "github" } });

    expect(signInEventOf(event, "google")).toMatchObject({ slug: "github", sso: true });
  });

  it.each([
    ["an event that is not about a sign-in", audit("request.api")],
    [
      "a failure naming a phase the check does not know",
      audit("auth.sso.resolution.failed", { payload: { phase: "somewhere_else" } }),
    ],
  ])("ignores %s", (_name, event) => {
    expect(signInEventOf(event, "google")).toBeUndefined();
  });
});

const RUNTIME_EVENT_TYPES = readFileSync(
  new URL("../../../../../internal/domain/event.go", import.meta.url),
  "utf8",
);
const SSO_EVENT_TYPES_THE_RUNTIME_RECORDS = [
  ...RUNTIME_EVENT_TYPES.matchAll(/EventType = "(auth\.sso\.[a-z.]+)"/g),
].map((match) => match[1] ?? "");

describe("the SSO event types the runtime records", () => {
  it("are found in the runtime's source, or the cases below prove nothing", () => {
    expect(SSO_EVENT_TYPES_THE_RUNTIME_RECORDS.length).toBe(4);
  });

  it.each(SSO_EVENT_TYPES_THE_RUNTIME_RECORDS)(
    "include %s, which the check asks for and reads",
    (type) => {
      expect(SIGN_IN_EVENT_TYPES).toContain(type);
      expect(
        signInEventOf(
          audit(type, { payload: { phase: "resolved", connection_slug: "google" } }),
          "google",
        ),
      ).toBeDefined();
    },
  );
});

const page = (ids: readonly string[], next?: string): AuditPage => ({
  data: ids.map((id) => audit("auth.attempt.created", { id })),
  ...(next === undefined ? {} : { next_page_token: next }),
});

/** A stream newest first, served `size` events to a page. */
function aStream(ids: readonly string[], size: number) {
  const asked: (string | undefined)[] = [];
  const fetchPage = async (token: string | undefined): Promise<AuditPage> => {
    asked.push(token);
    const from = token === undefined ? 0 : Number(token);
    const to = from + size;
    return page(ids.slice(from, to), to < ids.length ? String(to) : undefined);
  };
  return { fetchPage, asked };
}

describe("readNewAuditEvents", () => {
  it("returns what is new, oldest first", async () => {
    const { fetchPage } = aStream(["e3", "e2", "e1"], 10);

    const events = await readNewAuditEvents(fetchPage, new Set(["e1"]), 10);

    expect(events.map((event) => event.id)).toEqual(["e2", "e3"]);
  });

  it("reads back through pages until it reaches an event it knows, so none between two reads is missed", async () => {
    const { fetchPage, asked } = aStream(["e6", "e5", "e4", "e3", "e2", "e1"], 2);

    const events = await readNewAuditEvents(fetchPage, new Set(["e3"]), 10);

    expect([events.map((event) => event.id), asked]).toEqual([
      ["e4", "e5", "e6"],
      [undefined, "2"],
    ]);
  });

  it("stops at the page limit rather than reading a stream without end", async () => {
    const { fetchPage, asked } = aStream(["e6", "e5", "e4", "e3", "e2", "e1"], 2);

    await readNewAuditEvents(fetchPage, new Set(), 2);

    expect(asked).toEqual([undefined, "2"]);
  });

  it("returns nothing for an empty stream", async () => {
    const { fetchPage } = aStream([], 2);

    expect(await readNewAuditEvents(fetchPage, new Set(), 10)).toEqual([]);
  });
});

describe("watchSignInAudit", () => {
  const instantly = async () => {};

  it("reports only events recorded after it began", async () => {
    const stop = new AbortController();
    const reads = [
      page(["evt_old"]),
      {
        data: [
          audit("auth.sso.authorization.failed", {
            id: "evt_new",
            payload: { connection_slug: "google" },
          }),
          audit("auth.attempt.created", { id: "evt_old" }),
        ],
      },
    ];
    const fetchPage = async (): Promise<AuditPage> => reads.shift() ?? { data: [] };

    const events = (await watchSignInAudit(fetchPage, "google", instantly, 0, stop.signal))[
      Symbol.asyncIterator
    ]();
    const first = await events.next();
    stop.abort();

    expect(first.value).toMatchObject({ phase: "callback_received", status: "failed" });
  });

  it("resolves only once the stream it compares against has been read", async () => {
    const stop = new AbortController();
    const released = new AbortController();
    const slowRead = new Promise<AuditPage>((resolve) =>
      released.signal.addEventListener("abort", () => resolve({ data: [] }), { once: true }),
    );

    const watching = watchSignInAudit(() => slowRead, "google", instantly, 0, stop.signal);
    const early = await Promise.race([
      watching.then(() => "resolved"),
      Promise.resolve("still reading"),
    ]);
    released.abort();
    await watching;
    stop.abort();

    expect(early).toBe("still reading");
  });

  it("carries on after a read fails once, since the person is still signing in", async () => {
    const stop = new AbortController();
    const reads: Array<() => AuditPage> = [
      () => page(["evt_old"]),
      () => {
        throw new Error("503");
      },
      () => ({
        data: [
          audit("auth.sso.authorization.failed", {
            id: "evt_new",
            payload: { connection_slug: "google" },
          }),
        ],
      }),
    ];
    const fetchPage = async (): Promise<AuditPage> => reads.shift()?.() ?? { data: [] };

    const events = (await watchSignInAudit(fetchPage, "google", instantly, 0, stop.signal))[
      Symbol.asyncIterator
    ]();
    const first = await events.next();
    stop.abort();

    expect(first.value).toMatchObject({ phase: "callback_received" });
  });

  it("gives up once reads keep failing, saying why", async () => {
    const stop = new AbortController();
    const reads = [() => page([])];
    const fetchPage = async (): Promise<AuditPage> => {
      const read = reads.shift();
      if (read === undefined) {
        throw new Error("503");
      }
      return read();
    };

    const events = (await watchSignInAudit(fetchPage, "google", instantly, 0, stop.signal))[
      Symbol.asyncIterator
    ]();

    await expect(events.next()).rejects.toThrow("503");
    stop.abort();
  });

  it("ends when the signal aborts", async () => {
    const stop = new AbortController();
    stop.abort();

    const events = await watchSignInAudit(
      async () => ({ data: [] }),
      "google",
      instantly,
      0,
      stop.signal,
    );

    expect(await events[Symbol.asyncIterator]().next()).toMatchObject({ done: true });
  });
});
