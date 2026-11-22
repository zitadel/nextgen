import { describe, expect, it } from "vitest";

import { type Grant, type Member, initials, toMemberRows } from "./members";

const NOW = Date.parse("2026-11-19T12:00:00Z");
const OPS = { team_id: "team_ops", name: "Ops" };
const OWNERS = { team_id: "team_owner", name: "Founders" };

function grant(id: string, overrides: Partial<Grant> = {}): Grant {
  return {
    id,
    project_id: "proj_1",
    object_type: "project",
    relation: "admin",
    created_at: "2026-09-01T10:00:00Z",
    ...overrides,
  } as Grant;
}

function person(userId: string, display?: string) {
  return { user_id: userId, display, identifier: `${userId}@acme.com` };
}

function member(userId: string, sources: Member["sources"]): Member {
  return { user: person(userId, userId), relation: "admin", sources } as Member;
}

describe("toMemberRows", () => {
  it("gives a person one row for all their grants, roles strongest first", () => {
    const rows = toMemberRows(
      [],
      [
        grant("a", { relation: "editor", user: person("maya") }),
        grant("b", { relation: "admin", user: person("maya") }),
      ],
      undefined,
      NOW,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "user",
      roles: ["admin", "editor"],
      action: { kind: "remove-role", grantIds: ["a"], role: "editor", keeps: "admin" },
    });
  });

  it("holds only the roles still live, and clears expired ones with the last", () => {
    const rows = toMemberRows(
      [],
      [
        grant("old", {
          relation: "admin",
          user: person("maya"),
          expires_at: "2026-01-01T00:00:00Z",
        }),
        grant("now", { relation: "viewer", user: person("maya") }),
        grant("gone", {
          relation: "editor",
          user: person("sol"),
          expires_at: "2026-01-01T00:00:00Z",
        }),
      ],
      undefined,
      NOW,
    );
    expect(rows.find((row) => row.name === "maya@acme.com")).toMatchObject({
      roles: ["viewer"],
      action: { kind: "remove-access", grantIds: ["old", "now"] },
    });
    expect(rows.find((row) => row.name === "sol@acme.com")).toMatchObject({
      roles: ["editor"],
      expiry: { kind: "expired" },
      action: { kind: "remove-access", grantIds: ["gone"] },
    });
  });

  it("removes the weakest of three roles, keeping the strongest", () => {
    const rows = toMemberRows(
      [],
      (["viewer", "admin", "editor"] as const).map((relation) =>
        grant(relation, { relation, user: person("maya") }),
      ),
      undefined,
      NOW,
    );
    expect(rows[0]).toMatchObject({
      roles: ["admin", "editor", "viewer"],
      action: { kind: "remove-role", grantIds: ["viewer"], role: "viewer", keeps: "admin" },
    });
  });

  it("clears every grant of a row whose roles have all expired", () => {
    const rows = toMemberRows(
      [],
      [
        grant("a", { user: person("maya"), expires_at: "2026-01-01T00:00:00Z" }),
        grant("b", {
          relation: "viewer",
          user: person("maya"),
          expires_at: "2026-02-01T00:00:00Z",
        }),
      ],
      undefined,
      NOW,
    );
    expect(rows[0]).toMatchObject({
      roles: ["admin", "viewer"],
      expiry: { kind: "expired" },
      action: { kind: "remove-access", grantIds: ["a", "b"] },
    });
  });

  it("says when the role a row keeps ends", () => {
    const rows = toMemberRows(
      [],
      [
        grant("a", { user: person("maya"), expires_at: "2026-11-23T00:00:00Z" }),
        grant("b", { relation: "viewer", user: person("maya") }),
      ],
      undefined,
      NOW,
    );
    expect(rows[0]?.action).toEqual({
      kind: "remove-role",
      grantIds: ["b"],
      role: "viewer",
      keeps: "admin",
      keepsUntil: "2026-11-23T00:00:00Z",
    });
  });

  it("offers the owning team's grant as a role to remove, never its access", () => {
    const rows = toMemberRows(
      [member("ada", [{ type: "owning_team", team: OWNERS }])],
      [grant("g", { relation: "viewer", team: OWNERS, expires_at: "2026-01-01T00:00:00Z" })],
      undefined,
      NOW,
    );
    expect(rows[0]).toMatchObject({
      roles: ["admin"],
      expiry: { kind: "never" },
      action: { kind: "remove-role", grantIds: ["g"], role: "viewer", keeps: "admin" },
    });
  });

  it("puts a person whose access expired after those who hold a role", () => {
    const rows = toMemberRows(
      [],
      [
        grant("a", { user: person("x", "Xed"), expires_at: "2026-01-01T00:00:00Z" }),
        grant("b", { relation: "editor", user: person("y", "Yan") }),
      ],
      undefined,
      NOW,
    );
    expect(rows.map((row) => row.name)).toEqual(["Yan", "Xed"]);
  });

  it("names a person by display, then identifier, then id", () => {
    const rows = toMemberRows(
      [],
      [
        grant("a", { user: { user_id: "u1", display: "Maya", identifier: "maya@acme.com" } }),
        grant("b", { user: { user_id: "u2", identifier: "sol@acme.com" } }),
        grant("c", { user: { user_id: "u3" } }),
      ],
      undefined,
      NOW,
    );
    expect(rows.map((row) => [row.name, row.kind === "user" ? row.secondary : null])).toEqual([
      ["Maya", "maya@acme.com"],
      ["sol@acme.com", undefined],
      ["u3", undefined],
    ]);
  });

  it("ends a row's access with its last live grant", () => {
    const end = (expires: (string | undefined)[]) =>
      toMemberRows(
        [],
        expires.map((expires_at, index) =>
          grant(`g${index}`, {
            relation: index === 0 ? "admin" : "editor",
            user: person("maya"),
            expires_at,
          }),
        ),
        undefined,
        NOW,
      )[0]?.expiry;
    expect(end([undefined])).toEqual({ kind: "never" });
    expect(end(["2026-12-31T00:00:00Z", "2027-01-31T00:00:00Z"])).toEqual({
      kind: "on",
      at: "2027-01-31T00:00:00Z",
    });
    expect(end(["2026-12-31T00:00:00Z", undefined])).toEqual({ kind: "never" });
    expect(end(["2026-01-01T00:00:00Z", "2027-01-31T00:00:00Z"])).toEqual({
      kind: "on",
      at: "2027-01-31T00:00:00Z",
    });
    expect(end(["2026-01-01T00:00:00Z"])).toEqual({ kind: "expired" });
  });

  it("lists a team with the people the members list names it for", () => {
    const rows = toMemberRows(
      [
        member("zoe", [{ type: "grant", grant_id: "t", team: OPS }]),
        member("ada", [{ type: "grant", grant_id: "t", team: OPS }]),
      ],
      [grant("t", { relation: "viewer", team: OPS })],
      undefined,
      NOW,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "team",
      name: "Ops",
      roles: ["viewer"],
      action: { kind: "remove-access", grantIds: ["t"] },
    });
    expect(rows[0]?.kind === "team" && rows[0].members.map((each) => each.userId)).toEqual([
      "ada",
      "zoe",
    ]);
  });

  it("names a team by its id until a ref carries its name", () => {
    const rows = toMemberRows(
      [member("maya", [{ type: "grant", grant_id: "t", team: { team_id: "team_ops" } }])],
      [grant("a", { user: person("maya") }), grant("t", { team: OPS })],
      undefined,
      NOW,
    );
    expect(rows.map((row) => row.name)).toEqual(["maya@acme.com", "Ops"]);
    expect(rows[0]).toMatchObject({ teams: ["Ops"] });
    expect(
      toMemberRows([], [grant("t", { team: { team_id: "team_x" } })], undefined, NOW)[0]?.name,
    ).toBe("team_x");
  });

  it("keeps a team whose grant reaches nobody", () => {
    const rows = toMemberRows([], [grant("t", { team: OPS })], undefined, NOW);
    expect(rows[0]).toMatchObject({ kind: "team", members: [] });
  });

  it("lists the owning team as admin, with nothing to revoke", () => {
    const rows = toMemberRows(
      [member("ada", [{ type: "owning_team", team: OWNERS }])],
      [],
      undefined,
      NOW,
    );
    expect(rows[0]).toMatchObject({
      kind: "team",
      name: "Founders",
      roles: ["admin"],
      expiry: { kind: "never" },
      action: undefined,
    });
  });

  it("marks the viewer, puts them first and offers them nothing", () => {
    const rows = toMemberRows(
      [],
      [
        grant("a", { user: person("ada", "Ada") }),
        grant("b", { relation: "viewer", user: person("me", "Zed") }),
      ],
      "me",
      NOW,
    );
    expect(rows.map((row) => row.name)).toEqual(["Zed", "Ada"]);
    expect(rows[0]).toMatchObject({ self: true, action: undefined });
  });

  it("orders people by role, then name, before teams by name", () => {
    const rows = toMemberRows(
      [],
      [
        grant("1", { relation: "viewer", user: person("a", "Amy") }),
        grant("2", { relation: "admin", user: person("b", "Bea") }),
        grant("3", { relation: "admin", user: person("c", "Al") }),
        grant("4", { team: { team_id: "t2", name: "Zeta" } }),
        grant("5", { team: { team_id: "t1", name: "Alpha" } }),
      ],
      undefined,
      NOW,
    );
    expect(rows.map((row) => row.name)).toEqual(["Al", "Bea", "Amy", "Alpha", "Zeta"]);
  });

  it("names the teams a person also holds the project through", () => {
    const rows = toMemberRows(
      [member("maya", [{ type: "grant", grant_id: "t", team: OPS }])],
      [grant("a", { user: person("maya") }), grant("t", { team: OPS })],
      undefined,
      NOW,
    );
    expect(rows.find((row) => row.kind === "user")).toMatchObject({ teams: ["Ops"] });
  });
});

describe("initials", () => {
  it("takes the first letters of two words, or two of one", () => {
    expect(initials("Theo Müller")).toBe("TM");
    expect(initials("ada@acme.com")).toBe("AD");
  });
});
