import { describe, expect, it } from "vitest";

import { draftForRevision, type ObjectDraft, revisionPatch } from "@/features/schemas/schema-form";
import { schemaFields, type SchemaField } from "@/features/schemas/model";
import {
  canTakeValue,
  isOlderRevision,
  planRevisionMove,
  revisionAttributes,
  signInChanges,
} from "./revision-move";

function only(properties: Record<string, unknown>, required: string[] = []): SchemaField {
  const [entry] = schemaFields({ properties, required });
  if (!entry) throw new Error("no field");
  return entry;
}

const NAME = { givenName: { type: "string" } };

describe("planRevisionMove", () => {
  it("asks nothing when the server refuses nothing", () => {
    const move = planRevisionMove(
      { properties: NAME },
      { properties: { ...NAME, nickname: { type: "string" } } },
      { givenName: "Ada" },
    );

    expect([...move.review]).toEqual([]);
    expect(move.removed).toEqual([]);
    expect(move.kept).toEqual({ givenName: "Ada" });
  });

  it("asks about a field the server refused, whatever the schema seems to say", () => {
    const move = planRevisionMove(
      { properties: { field: { type: "string" } } },
      { properties: { field: { type: "string" } } },
      { field: "x" },
      ["field"],
    );

    expect([...move.review]).toEqual(["field"]);
    expect(move.kept).toEqual({});
  });

  it("doesn't judge a value the server took, whatever the schema seems to say", () => {
    const move = planRevisionMove(
      { properties: { contact: { type: "string" } } },
      { properties: { contact: { type: "string", format: "email" } } },
      { contact: "not-an-email" },
    );

    expect([...move.review]).toEqual([]);
    expect(move.kept).toEqual({ contact: "not-an-email" });
  });

  it("asks about the object around a nested field the server refused", () => {
    const address = {
      properties: {
        address: { type: "object", required: ["city"], properties: { city: { type: "string" } } },
      },
    };

    expect([
      ...planRevisionMove(address, address, { address: {} }, ["address.city"]).review,
    ]).toEqual(["address"]);
  });

  it("removes what the server refused and no field stands for", () => {
    const move = planRevisionMove(
      { properties: { ...NAME, nickname: { type: "string" } } },
      { properties: NAME },
      { givenName: "Ada", nickname: "ada" },
      ["nickname"],
    );

    expect(move.removed).toEqual([
      { name: "nickname", path: ["nickname"], value: "ada", mustRemove: true },
    ]);
    expect([...move.refused]).toEqual([]);
  });

  it("removes a stored null the same way", () => {
    const move = planRevisionMove(
      { properties: { ...NAME, nickname: { type: ["string", "null"] } } },
      { properties: NAME },
      { givenName: "Ada", nickname: null },
      ["nickname"],
    );

    expect(revisionAttributes({}, move.removed)).toEqual({ nickname: null });
  });

  it("leaves removing it optional when the server took it", () => {
    const move = planRevisionMove(
      { properties: { ...NAME, nickname: { type: "string" } } },
      { properties: NAME },
      { givenName: "Ada", nickname: "ada" },
    );

    expect(move.removed.map((entry) => entry.mustRemove)).toEqual([false]);
    expect(move.kept).toEqual({ givenName: "Ada" });
  });

  it("finds a removed attribute inside an object, by its path", () => {
    const address = (properties: Record<string, unknown>) => ({
      properties: { address: { type: "object", properties } },
    });
    const move = planRevisionMove(
      address({ city: { type: "string" }, fax: { type: "string" } }),
      address({ city: { type: "string" } }),
      { address: { city: "Zurich", fax: "1" } },
    );

    expect(move.removed.map((entry) => entry.name)).toEqual(["address.fax"]);
  });

  it("offers a new optional field while something leaves, as a possible rename", () => {
    const move = planRevisionMove(
      { properties: { ...NAME, surname: { type: "string" } } },
      { properties: { ...NAME, lastName: { type: "string" } } },
      { givenName: "Ada", surname: "Lovelace" },
      ["surname"],
    );

    expect([...move.review]).toEqual(["lastName"]);
    expect(move.removed.map((entry) => entry.name)).toEqual(["surname"]);
  });

  it("stays quiet about a new optional field when nothing has to go", () => {
    const move = planRevisionMove(
      { properties: { ...NAME, surname: { type: "string" } } },
      { properties: { ...NAME, lastName: { type: "string" } } },
      { givenName: "Ada", surname: "Lovelace" },
    );

    expect([...move.review]).toEqual([]);
    expect(move.removed.map((entry) => entry.mustRemove)).toEqual([false]);
  });

  it("puts a required empty string in front of the administrator, as the form refuses it", () => {
    const move = planRevisionMove(
      { properties: { name: { type: "string" } } },
      { required: ["name"], properties: { name: { type: "string" } } },
      { name: "" },
    );

    expect([...move.review]).toEqual(["name"]);
  });

  describe("a key the server refused inside an array item", () => {
    const addresses = (properties: Record<string, unknown>) => ({
      properties: { addresses: { type: "array", items: { type: "object", properties } } },
    });
    const current = addresses({ city: { type: "string" }, fax: { type: "string" } });
    const target = addresses({ city: { type: "string" } });
    const stored = [
      { city: "Zurich", fax: "1" },
      { city: "Bern", fax: "2" },
    ];
    const refused = ["addresses.0.fax", "addresses.1.fax"];

    it("is listed, and writes the array back without it, keeping the rest", () => {
      const move = planRevisionMove(current, target, { addresses: stored }, refused);

      expect(move.removed.map((entry) => entry.name)).toEqual(refused);
      expect([...move.review]).toEqual(["addresses"]);
      expect(revisionPatch(move.root, { addresses: stored }, move.draft, move.refused)).toEqual({
        addresses: [{ city: "Zurich" }, { city: "Bern" }],
      });
    });

    it("is not deleted by a merge patch, which can't reach into an array", () => {
      const move = planRevisionMove(current, target, { addresses: stored }, refused);

      expect(revisionAttributes({}, move.removed)).toEqual({});
    });

    it("stays when the server took it, with nothing to review", () => {
      const move = planRevisionMove(current, target, { addresses: stored });

      expect(move.removed).toEqual([]);
      expect([...move.review]).toEqual([]);
    });
  });

  it("offers an object holding a new field while a value inside it must go", () => {
    const address = (properties: Record<string, unknown>) => ({
      properties: { address: { type: "object", properties } },
    });
    const move = planRevisionMove(
      address({ surname: { type: "string" } }),
      address({ lastName: { type: "string" } }),
      { address: { surname: "Lovelace" } },
      ["address.surname"],
    );

    expect([...move.review]).toEqual(["address"]);
    expect(move.removed.map((entry) => entry.name)).toEqual(["address.surname"]);
  });

  it("stays quiet about a new field in an object when nothing has to go", () => {
    const address = (properties: Record<string, unknown>) => ({
      properties: { address: { type: "object", properties } },
    });
    const move = planRevisionMove(
      address({ city: { type: "string" } }),
      address({ city: { type: "string" }, zip: { type: "string" } }),
      { address: { city: "Zurich" } },
    );

    expect([...move.review]).toEqual([]);
  });
});

describe("signInChanges", () => {
  const base = {
    "x-identifier": "email",
    "x-auth-methods": { password: { enabled: true } },
    properties: { email: { type: "string", "x-unique": "project" } },
  };

  it("finds nothing between revisions that sign in alike", () => {
    expect(signInChanges(base, { ...base, title: "Renamed" })).toEqual([]);
  });

  it("finds nothing in the same providers listed in another order", () => {
    const sso = (providers: string[]) => ({
      "x-auth-methods": { sso: { enabled: true, providers } },
    });

    expect(signInChanges(sso(["a", "b"]), sso(["b", "a"]))).toEqual([]);
    expect(signInChanges(sso(["a", "b"]), sso(["a"]))).toEqual(["the sign-in methods"]);
  });

  it("names a changed identifier, sign-in method and uniqueness rule", () => {
    expect(
      signInChanges(base, {
        "x-identifier": "phone",
        "x-auth-methods": { passkey: { enabled: true } },
        properties: { email: { type: "string" } },
      }),
    ).toEqual(["the sign-in identifier", "the sign-in methods", "the uniqueness rules"]);
  });
});

describe("a move's draft and patch", () => {
  const rootOver = (properties: Record<string, unknown>, required: string[] = []) => ({
    kind: "object" as const,
    key: "",
    attributePath: "",
    label: "",
    required: true,
    nullable: false,
    fields: schemaFields({ properties, required }),
  });

  const moved = (
    properties: Record<string, unknown>,
    attributes: Record<string, unknown>,
    { refused = [], fields }: { refused?: string[]; fields?: ObjectDraft["fields"] } = {},
  ) => {
    const root = rootOver(properties);
    const named = new Set(refused);
    const draft = draftForRevision(root, attributes, named);
    return revisionPatch(root, attributes, fields ? { ...draft, fields } : draft, named);
  };

  it("converts a stored string to the number its new type needs", () => {
    // A draft of `"36"` reads the same as the stored `"36"`, and must still be sent.
    const properties = { age: { type: "integer" } };

    expect(draftForRevision(rootOver(properties), { age: "36" }).fields.age).toBe("36");
    expect(moved(properties, { age: "36" }, { refused: ["age"] })).toEqual({ age: 36 });
  });

  it("sends nothing for a value that is already what the field would send", () => {
    expect(moved({ a: { type: "string" } }, { a: "x" })).toEqual({});
    expect(moved({ a: { type: "boolean" } }, { a: false })).toEqual({});
  });

  it("deletes a value the form emptied", () => {
    expect(moved({ a: { type: "integer" } }, { a: "36" }, { fields: { a: "" } })).toEqual({
      a: null,
    });
    expect(moved({ a: { type: "integer" } }, {}, { fields: { a: "" } })).toEqual({});
  });

  it("starts a value of the wrong shape blank rather than locked", () => {
    const root = rootOver({
      active: { type: "boolean" },
      country: { type: "string", enum: ["CH"] },
    });
    const draft = draftForRevision(root, { active: "yes", country: "Switzerland" });

    expect(draft.fields).toEqual({ active: "", country: "" });
  });

  it("unlocks a value of the wrong shape inside a row the server refused", () => {
    const items = { type: "object", properties: { active: { type: "boolean" } } };
    const root = rootOver({ rows: { type: "array", items } });
    const draft = draftForRevision(root, { rows: [{ active: "yes" }] }, new Set(["rows.0.active"]));
    const rows = draft.fields.rows;

    if (typeof rows !== "object" || rows.kind !== "array") throw new Error("not rows");
    const [row] = rows.rows;
    if (typeof row?.draft !== "object" || row.draft.kind !== "object") throw new Error("no row");
    expect(row.draft.fields.active).toBe("");
  });

  it("converts the rows the server refused, leaving the ones it took", () => {
    const properties = { ages: { type: "array", items: { type: "integer" } } };

    expect(moved(properties, { ages: ["36", 40] }, { refused: ["ages.0"] })).toEqual({
      ages: [36, 40],
    });
  });

  it("writes back a row the server took exactly as stored", () => {
    const properties = { ages: { type: "array", items: { type: "integer" } } };

    expect(moved(properties, { ages: ["36", "40"] }, { refused: ["ages.0"] })).toEqual({
      ages: [36, "40"],
    });
  });

  it("sends nothing for an array the server took as it is", () => {
    const properties = { ages: { type: "array", items: { type: "integer" } } };

    expect(moved(properties, { ages: [36] })).toEqual({});
  });

  it("deletes a stored null the server refused, when left blank", () => {
    expect(moved({ a: { type: "string" } }, { a: null }, { refused: ["a"] })).toEqual({ a: null });
  });

  it("replaces a stored null the server refused, when filled in", () => {
    expect(
      moved({ a: { type: "string" } }, { a: null }, { refused: ["a"], fields: { a: "x" } }),
    ).toEqual({ a: "x" });
  });

  it("leaves a stored null the server took", () => {
    expect(moved({ a: { type: ["string", "null"] } }, { a: null })).toEqual({});
  });

  it("keeps a whole opaque field locked, which nothing here can write", () => {
    const properties = { a: { oneOf: [{ type: "string" }] } };
    const draft = draftForRevision(rootOver(properties), { a: "x" });

    expect(draft.fields.a).toEqual({ kind: "locked", value: "x" });
    expect(moved(properties, { a: "x" }, { refused: ["a"] })).toEqual({});
  });
});

describe("revisionAttributes", () => {
  it("merges changes and nested removals into one patch", () => {
    expect(
      revisionAttributes({ address: { city: "Zurich" }, lastName: "Lovelace" }, [
        { name: "surname", path: ["surname"], value: "L", mustRemove: true },
        { name: "address.fax", path: ["address", "fax"], value: "1", mustRemove: false },
      ]),
    ).toEqual({
      address: { city: "Zurich", fax: null },
      lastName: "Lovelace",
      surname: null,
    });
  });
});

describe("revisionAttributes and a hostile key", () => {
  it("writes `__proto__` as the plain key it is, and touches no prototype", () => {
    const changes = JSON.parse('{"__proto__":{"polluted":true}}') as Record<string, unknown>;
    const merged = revisionAttributes(changes, [
      { name: "__proto__.x", path: ["__proto__", "x"], value: 1, mustRemove: true },
    ]);

    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
    expect(JSON.stringify(merged)).toBe('{"__proto__":{"polluted":true,"x":null}}');
  });
});

describe("isOlderRevision", () => {
  const history = [
    { id: "new", createdAt: "2026-03-01T00:00:00Z" },
    { id: "middle", createdAt: "2026-02-01T00:00:00Z" },
    { id: "old", createdAt: "2026-01-01T00:00:00Z" },
  ];

  it("goes by the history's order, newest first", () => {
    expect(isOlderRevision(history, "old", "middle")).toBe(true);
    expect(isOlderRevision(history, "new", "middle")).toBe(false);
    expect(isOlderRevision(history, "middle", "middle")).toBe(false);
  });

  it("doesn't say so about a revision the history leaves out", () => {
    expect(isOlderRevision(history, "old", "unreadable")).toBe(false);
    expect(isOlderRevision(history, "unreadable", "new")).toBe(false);
  });
});

describe("canTakeValue", () => {
  it("takes a value of the field's own kind only", () => {
    expect(canTakeValue(only({ a: { type: "string" } }), "x")).toBe(true);
    expect(canTakeValue(only({ a: { type: "string" } }), 1)).toBe(false);
    expect(canTakeValue(only({ a: { type: "number" } }), 1)).toBe(true);
    expect(canTakeValue(only({ a: { type: "boolean" } }), "x")).toBe(false);
    expect(canTakeValue(only({ a: { type: "string", enum: ["x"] } }), "x")).toBe(false);
  });
});
