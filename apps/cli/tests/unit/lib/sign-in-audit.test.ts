import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { type AuditEvent, signInEventOf, watchSignInAudit } from "../../../src/lib/sign-in-audit";

const audit = (event_type: string, overrides: Partial<AuditEvent> = {}): AuditEvent => ({
  id: `evt_${event_type}`,
  event_type,
  entity_id: "att_1",
  ...overrides,
});

describe("signInEventOf", () => {
  it.each([
    ["auth.attempt.created", "ceremony_started", "ok"],
    ["auth.sso.authorization.failed", "callback_received", "failed"],
    ["auth.sso.exchange.failed", "exchange_finished", "failed"],
    ["auth.sso.exchange.succeeded", "exchange_finished", "ok"],
    ["idp.identity_link.created", "user_created", "ok"],
    ["auth.attempt.handed_off", "handed_off", "ok"],
  ])("reads %s as %s (%s)", (type, phase, status) => {
    expect(signInEventOf(audit(type), "google")).toMatchObject({ slug: "google", phase, status });
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
        audit("auth.sso.exchange.succeeded", { payload: { auth_attempt_id: "att_9" } }),
        "g",
      )?.flowId,
      signInEventOf(audit("auth.attempt.created"), "g")?.flowId,
    ]).toEqual(["att_9", "att_1"]);
  });

  it("ignores an event of another connection", () => {
    const event = audit("auth.sso.exchange.succeeded", { payload: { connection_slug: "github" } });

    expect(signInEventOf(event, "google")).toBeUndefined();
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

  it.each(SSO_EVENT_TYPES_THE_RUNTIME_RECORDS)("include %s, which the check reads", (type) => {
    expect(signInEventOf(audit(type, { payload: { phase: "resolved" } }), "google")).toBeDefined();
  });
});

describe("watchSignInAudit", () => {
  const instantly = async () => {};

  it("reports only events recorded after it began", async () => {
    const stop = new AbortController();
    const before = audit("auth.attempt.created", { id: "evt_old" });
    const after = audit("auth.sso.authorization.failed", { id: "evt_new" });
    const reads = [[before], [before, after]];
    const list = async () => reads.shift() ?? [before, after];

    const events = (await watchSignInAudit(list, "google", instantly, 0, stop.signal))[
      Symbol.asyncIterator
    ]();
    const first = await events.next();
    stop.abort();

    expect(first.value).toMatchObject({ phase: "callback_received", status: "failed" });
  });

  it("resolves only once the stream it compares against has been read", async () => {
    const stop = new AbortController();
    const released = new AbortController();
    const slowRead = new Promise<readonly AuditEvent[]>((resolve) =>
      released.signal.addEventListener("abort", () => resolve([]), { once: true }),
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

  it("ends when the signal aborts", async () => {
    const stop = new AbortController();
    stop.abort();

    const events = await watchSignInAudit(async () => [], "google", instantly, 0, stop.signal);

    expect(await events[Symbol.asyncIterator]().next()).toMatchObject({ done: true });
  });
});
