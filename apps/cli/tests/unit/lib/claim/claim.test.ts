import { describe, expect, it } from "vitest";

import { Claim } from "@/lib/claim";

/** The state of a claim read from `input`. */
function claimState(input: Parameters<typeof Claim.state>[0]): ReturnType<typeof Claim.state> {
  return Claim.state(input);
}

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
      deadline: Claim.deadline(recent).toISOString(),
    });

    const stale = "2026-01-01T00:00:00.000Z";
    expect(
      claimState({ secret: { created_at: stale }, server: "https://api.zitadel.cloud" }),
    ).toEqual({
      kind: "detached",
      claimable: false,
      deadline: Claim.deadline(stale).toISOString(),
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
    expect(Claim.isAttached(ATTACHED)).toBe(true);
    expect(Claim.isAttached(DETACHED)).toBe(false);
    expect(Claim.isAttached({ team_id: "team-001" })).toBe(false);
    expect(Claim.isAttached({ claimed_at: ATTACHED.claimed_at })).toBe(false);
  });
});

describe("claim window deadline", () => {
  it("adds the 14-day window to the creation time", () => {
    expect(Claim.deadline("2026-09-04T10:00:00.000Z").toISOString()).toBe(
      "2026-09-18T10:00:00.000Z",
    );
  });

  // Setup calls this moments after creating the project, so "now" is the
  // honest stand-in when the response carried no usable timestamp.
  it("falls back to now for a missing or malformed creation time", () => {
    const now = Date.parse("2026-09-04T10:00:00.000Z");
    expect(Claim.deadline(undefined, now).toISOString()).toBe("2026-09-18T10:00:00.000Z");
    expect(Claim.deadline("not-a-date", now).toISOString()).toBe("2026-09-18T10:00:00.000Z");
  });
});
