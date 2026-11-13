import { describe, expect, it } from "vitest";

import {
  analyticsRole,
  describeExpiry,
  effectiveStatus,
  invitationMessage,
  inviterLabel,
  roleInProse,
  roleLabel,
} from "./model";

const NOW = new Date("2026-11-10T12:00:00Z");
const editor = { type: "project_member", project_member: { relation: "editor" } } as const;
const viewer = { type: "project_member", project_member: { relation: "viewer" } } as const;

describe("describeExpiry", () => {
  it.each([
    ["2026-11-13T12:00:00Z", "Expires in 3 days"],
    // A link made a minute ago still reads as the three days it was given.
    ["2026-11-13T11:59:00Z", "Expires in 3 days"],
    ["2026-11-12T23:00:00Z", "Expires in 2 days"],
    ["2026-11-11T12:00:00Z", "Expires in 1 day"],
    ["2026-11-11T11:59:00Z", "Expires in 23 hours"],
    ["2026-11-10T13:30:00Z", "Expires in 1 hour"],
    ["2026-11-10T12:20:00Z", "Expires in less than an hour"],
  ])("%s reads %s", (expiresAt, expected) => {
    expect(describeExpiry(expiresAt, NOW)).toBe(expected);
  });

  it("says nothing for a date it cannot read", () => {
    expect(describeExpiry("soon", NOW)).toBe("");
  });
});

describe("effectiveStatus", () => {
  it("reads a pending invitation past its expiry as expired", () => {
    expect(effectiveStatus({ status: "pending", expires_at: "2026-11-10T11:59:59Z" }, NOW)).toBe(
      "expired",
    );
  });

  it("keeps a pending invitation with time left", () => {
    expect(effectiveStatus({ status: "pending", expires_at: "2026-11-11T00:00:00Z" }, NOW)).toBe(
      "pending",
    );
  });

  it("leaves a final status alone", () => {
    expect(effectiveStatus({ status: "accepted", expires_at: "2026-11-01T00:00:00Z" }, NOW)).toBe(
      "accepted",
    );
  });
});

describe("roles", () => {
  it("labels a project role, and a team invitation by its type", () => {
    expect(roleLabel(editor)).toBe("Editor");
    expect(roleLabel({ type: "team_member", team_member: { role: "member" } })).toBe("Team member");
  });

  it("takes the article the role needs in prose", () => {
    expect(roleInProse(editor)).toBe("an editor");
    expect(roleInProse(viewer)).toBe("a viewer");
  });

  it("combines the type and its role for analytics", () => {
    expect(analyticsRole(editor)).toBe("project_editor");
    expect(analyticsRole({ type: "team_member", team_member: { role: "member" } })).toBe(
      "team_member",
    );
  });
});

describe("invitationMessage", () => {
  it("wraps the link in what it grants and how long it lasts", () => {
    expect(invitationMessage("acme-app", editor, "https://console.example/x#token=t")).toBe(
      [
        "You're invited to join acme-app on Zitadel as an editor.",
        "",
        "Accept the invitation:",
        "https://console.example/x#token=t",
        "",
        "This link expires in 72 hours.",
      ].join("\n"),
    );
  });
});

describe("inviterLabel", () => {
  it("prefers the display name, then the identifier, then the id", () => {
    const inviter = { user_id: "user_1", identifier: "alex@example.com", display: "Alex Morgan" };
    expect(inviterLabel({ inviter })).toBe("Alex Morgan");
    expect(inviterLabel({ inviter: { ...inviter, display: undefined } })).toBe("alex@example.com");
    expect(inviterLabel({ inviter: { user_id: "user_1" } })).toBe("user_1");
  });

  it("has none without an inviter", () => {
    expect(inviterLabel({ inviter: null })).toBeUndefined();
    expect(inviterLabel({})).toBeUndefined();
  });
});
