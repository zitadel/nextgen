import { describe, expect, it } from "vitest";

import { claimAction, claimState, claimSummary } from "../../../src/lib/claim-state";

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

  it("is not applicable off the cloud, attached or not", () => {
    for (const server of ["http://localhost:8080", "https://zitadel.example.com"]) {
      expect(claimState({ secret: DETACHED, server })).toEqual({ kind: "not-applicable" });
      expect(claimState({ secret: ATTACHED, server })).toEqual({ kind: "not-applicable" });
    }
  });

  it("recognises cloud subdomains", () => {
    expect(claimState({ secret: DETACHED, server: "https://eu-1.zitadel.cloud" })).toEqual({
      kind: "detached",
    });
  });
});

describe("claim copy", () => {
  it("names the owning team once attached and nudges otherwise", () => {
    expect(claimSummary({ kind: "attached", team_id: "team-001", claimed_at: ATTACHED.claimed_at })).toBe(
      "attached to team team-001",
    );
    expect(claimSummary({ kind: "detached" })).toBe("temporary until you attach it to a team");
    expect(claimSummary({ kind: "not-applicable" })).toBeUndefined();
  });

  // The epic's 14-day lifetime is not enforced anywhere yet, so the nudge must
  // invite a claim without promising the project will actually be removed.
  it("promises no deletion", () => {
    expect(claimAction("0.1.0")).not.toMatch(/delete|removed|expire/i);
    expect(claimAction("0.1.0")).toContain("npx @zitadel/cli@latest claim");
  });

  // `unclaimed` is banned from the public docs by the vocabulary gate; keeping
  // it out of the strings themselves is what makes that gate easy to keep.
  it("stays on the vocabulary the claim command established", () => {
    for (const copy of [
      claimAction("0.1.0"),
      claimSummary({ kind: "detached" }) ?? "",
      claimSummary({ kind: "attached", team_id: "team-001", claimed_at: ATTACHED.claimed_at }) ?? "",
    ]) {
      expect(copy).not.toMatch(/\bunclaimed\b/i);
    }
  });
});
