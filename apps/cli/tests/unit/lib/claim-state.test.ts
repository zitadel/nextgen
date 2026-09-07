import { describe, expect, it } from "vitest";

import {
  claimAction,
  claimBoxAction,
  claimState,
  claimWindowClosedAction,
  claimWindowDeadline,
  isAttached,
} from "../../../src/lib/claim-state";

const ATTACHED = { claimed_at: "2026-08-01T10:00:00.000Z", team_id: "team-001" };
const DETACHED = {};

describe("claim state", () => {
  it("reads an attached project from the local secret", () => {
    expect(claimState({ secret: ATTACHED, server: "https://api.zitadel.cloud" })).toEqual({
      kind: "attached",
      team_id: "team-001",
      claimed_at: "2026-08-01T10:00:00.000Z",
    });
  });

  // Without a creation time the window cannot be classified, so the state is
  // lenient (claimable, no deadline): the server enforces, the CLI advises.
  it("reads a project with neither field as detached and claimable", () => {
    expect(claimState({ secret: DETACHED, server: "https://api.zitadel.cloud" })).toEqual({
      kind: "detached",
      claimable: true,
    });
  });

  it("classifies the claim window from the recorded creation time", () => {
    const recent = new Date(Date.now() - 60_000).toISOString();
    expect(
      claimState({ secret: { created_at: recent }, server: "https://api.zitadel.cloud" }),
    ).toEqual({
      kind: "detached",
      claimable: true,
      deadline: claimWindowDeadline(recent).toISOString(),
    });

    const stale = "2026-01-01T00:00:00.000Z";
    expect(
      claimState({ secret: { created_at: stale }, server: "https://api.zitadel.cloud" }),
    ).toEqual({
      kind: "detached",
      claimable: false,
      deadline: claimWindowDeadline(stale).toISOString(),
    });
  });

  // Mirrors the predicate `zitadel claim` uses before it decides to skip: a
  // half-written record is not an attachment, so the nudge stays and the
  // command can still recover the real answer from the platform.
  it("treats a half-written record as detached", () => {
    expect(
      claimState({ secret: { team_id: "team-001" }, server: "https://api.zitadel.cloud" }),
    ).toEqual({ kind: "detached", claimable: true });
    expect(
      claimState({
        secret: { claimed_at: ATTACHED.claimed_at },
        server: "https://api.zitadel.cloud",
      }),
    ).toEqual({ kind: "detached", claimable: true });
  });

  // Local stays not-applicable even though a bootstrapped local server can
  // host a claim: this classifier is offline by design, and only `setup`
  // (online anyway) probes the local server's runtime document to nudge.
  it("is not applicable off the cloud, attached or not", () => {
    for (const server of ["http://localhost:8080", "https://zitadel.example.com"]) {
      expect(claimState({ secret: DETACHED, server })).toEqual({ kind: "not-applicable" });
      expect(claimState({ secret: ATTACHED, server })).toEqual({ kind: "not-applicable" });
    }
  });

  it("recognises cloud subdomains", () => {
    expect(claimState({ secret: DETACHED, server: "https://eu-1.zitadel.cloud" })).toEqual({
      kind: "detached",
      claimable: true,
    });
  });
});

describe("attachment predicate", () => {
  // `zitadel claim` shares this to decide whether to skip, so it has to answer
  // on any server, not just the cloud ones the nudges care about.
  it("answers from the record alone, ignoring the server", () => {
    expect(isAttached(ATTACHED)).toBe(true);
    expect(isAttached(DETACHED)).toBe(false);
    expect(isAttached({ team_id: "team-001" })).toBe(false);
    expect(isAttached({ claimed_at: ATTACHED.claimed_at })).toBe(false);
  });
});

describe("claim copy", () => {
  // The 14-day window is now enforced at claim time (the server answers
  // proj.claim_window_expired), so the nudge may finally promise the deadline.
  // It still promises no deletion, because nothing removes the project when
  // the window closes (ADR 046 §Non-goals).
  it("promises the window, not deletion", () => {
    expect(claimAction("0.1.0")).toContain("within 14 days of creation");
    expect(claimAction("0.1.0")).not.toMatch(/delete|removed|expire/i);
    expect(claimAction("0.1.0")).toContain("npx @zitadel/cli@latest claim");
  });

  it("names the concrete deadline when the creation time is known", () => {
    const withDeadline = claimAction("0.1.0", claimWindowDeadline("2026-09-04T10:00:00.000Z"));
    expect(withDeadline).toContain("before ");
    expect(withDeadline).toContain("2026");
    expect(withDeadline).not.toContain("within 14 days of creation");
  });

  it("boxes the same nudge with the command pulled out of the prose", () => {
    const box = claimBoxAction("0.1.0");
    expect(box.command).toBe("npx @zitadel/cli@latest claim");
    expect(box.text).toContain("temporary until you attach it to a team");
    expect(box.text).not.toContain("npx");
  });

  // The closed-window counterpart stays reconciliatory: the local record can
  // be stale (claimed from another machine reads detached), so it keeps
  // quoting the claim command as the safe authoritative check alongside the
  // fresh-setup pointer.
  it("frames a closed window as reconciliation, not a verdict", () => {
    const closed = claimWindowClosedAction("0.1.0");
    expect(closed).toContain("claim window has closed");
    expect(closed).toContain("npx @zitadel/cli@latest claim");
    expect(closed).toContain("no longer be claimed");
    expect(closed).toContain("npx @zitadel/cli@latest setup");
    expect(closed).not.toMatch(/delete|removed|expire/i);
  });

  // `unclaimed` is banned from the public docs by the vocabulary gate; keeping
  // it out of the strings themselves is what makes that gate easy to keep.
  it("stays on the vocabulary the claim command established", () => {
    expect(claimAction("0.1.0")).not.toMatch(/\bunclaimed\b/i);
    expect(claimBoxAction("0.1.0").text).not.toMatch(/\bunclaimed\b/i);
    expect(claimWindowClosedAction("0.1.0")).not.toMatch(/\bunclaimed\b/i);
  });
});

describe("claim window deadline", () => {
  it("adds the 14-day window to the creation time", () => {
    expect(claimWindowDeadline("2026-09-04T10:00:00.000Z").toISOString()).toBe(
      "2026-09-18T10:00:00.000Z",
    );
  });

  // Setup calls this moments after creating the project, so "now" is the
  // honest stand-in when the response carried no usable timestamp.
  it("falls back to now for a missing or malformed creation time", () => {
    const now = Date.parse("2026-09-04T10:00:00.000Z");
    expect(claimWindowDeadline(undefined, now).toISOString()).toBe("2026-09-18T10:00:00.000Z");
    expect(claimWindowDeadline("not-a-date", now).toISOString()).toBe("2026-09-18T10:00:00.000Z");
  });
});
