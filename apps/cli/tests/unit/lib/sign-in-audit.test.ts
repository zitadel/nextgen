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

  it("names the attempt by the payload when the event is about a check, else by the entity", () => {
    expect([
      signInEventOf(
        audit("auth.sso.exchange.succeeded", { payload: { auth_attempt_id: "att_9" } }),
        "g",
      )?.flowId,
      signInEventOf(audit("auth.attempt.created"), "g")?.flowId,
    ]).toEqual(["att_9", "att_1"]);
  });

  it("ignores events that are not about a sign-in", () => {
    expect(signInEventOf(audit("request.api"), "google")).toBeUndefined();
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
    const [first] = await Promise.all([events.next()]);
    stop.abort();

    expect(first.value).toMatchObject({ phase: "callback_received", status: "failed" });
  });
});
