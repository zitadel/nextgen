import { describe, expect, it } from "vitest";

import { claimAction, claimState, isAttached } from "../../../src/lib/claim-state";

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

  it("reads a project with neither field as detached", () => {
    expect(claimState({ secret: DETACHED, server: "https://api.zitadel.cloud" })).toEqual({
      kind: "detached",
    });
  });

  // Mirrors the predicate `zitadel claim` uses before it decides to skip: a
  // half-written record is not an attachment, so the nudge stays and the
  // command can still recover the real answer from the platform.
  it("treats a half-written record as detached", () => {
    expect(
      claimState({ secret: { team_id: "team-001" }, server: "https://api.zitadel.cloud" }),
    ).toEqual({ kind: "detached" });
    expect(
      claimState({
        secret: { claimed_at: ATTACHED.claimed_at },
        server: "https://api.zitadel.cloud",
      }),
    ).toEqual({ kind: "detached" });
  });

  it("is not applicable off the cloud while nothing is attached", () => {
    for (const server of ["http://localhost:8080", "https://zitadel.example.com"]) {
      expect(claimState({ secret: DETACHED, server })).toEqual({ kind: "not-applicable" });
    }
  });

  // The local runtime carries the platform project and can take a claim, and
  // `zitadel claim` writes this record when it does. Only the nudge is
  // cloud-only; the record is reported wherever the project lives.
  it("reports an attached project on any server", () => {
    for (const server of ["http://localhost:8080", "https://zitadel.example.com"]) {
      expect(claimState({ secret: ATTACHED, server })).toEqual({
        kind: "attached",
        team_id: "team-001",
        claimed_at: "2026-08-01T10:00:00.000Z",
      });
    }
  });

  it("recognises cloud subdomains", () => {
    expect(claimState({ secret: DETACHED, server: "https://eu-1.zitadel.cloud" })).toEqual({
      kind: "detached",
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
  // The epic's 14-day lifetime is not enforced anywhere yet, so the nudge must
  // invite a claim without promising the project will actually be removed.
  it("promises no deletion", () => {
    expect(claimAction("0.1.0")).not.toMatch(/delete|removed|expire/i);
    expect(claimAction("0.1.0")).toContain("npx @zitadel/cli@latest claim");
  });

  // `unclaimed` is banned from the public docs by the vocabulary gate; keeping
  // it out of the strings themselves is what makes that gate easy to keep.
  it("stays on the vocabulary the claim command established", () => {
    expect(claimAction("0.1.0")).not.toMatch(/\bunclaimed\b/i);
  });
});
