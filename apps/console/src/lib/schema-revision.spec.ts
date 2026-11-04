import { describe, expect, it } from "vitest";

import { draftForRevision, revisionFieldPatch, storedValueFits } from "./schema-form";
import { schemaFields, type SchemaField } from "./schema";
import {
  canTakeValue,
  planRevisionMove,
  revisionAttributes,
  signInChanges,
} from "./schema-revision";

function only(properties: Record<string, unknown>, required: string[] = []): SchemaField {
  const [entry] = schemaFields({ properties, required });
  if (!entry) throw new Error("no field");
  return entry;
}

const NAME = { givenName: { type: "string" } };

describe("planRevisionMove", () => {
  it("asks nothing when the stored values already fit", () => {
    const move = planRevisionMove(
      { properties: NAME },
      { properties: { ...NAME, nickname: { type: "string" } } },
      { givenName: "Ada" },
    );

    expect([...move.review]).toEqual([]);
    expect(move.removed).toEqual([]);
    expect(move.kept).toEqual({ givenName: "Ada" });
  });

  it("asks for a required attribute the user has no value for", () => {
    const move = planRevisionMove(
      { properties: NAME },
      { required: ["country"], properties: { ...NAME, country: { type: "string" } } },
      { givenName: "Ada" },
    );

    expect([...move.review]).toEqual(["country"]);
  });

  it.each([
    ["a value outside a new list", { enum: ["CH", "DE"], type: "string" }, "Switzerland"],
    ["a string under a new integer", { type: "integer" }, "36"],
    ["a string under a new boolean", { type: "boolean" }, "yes"],
    ["a string past a new limit", { type: "string", maxLength: 2 }, "Zurich"],
  ])("asks about %s", (_, property, stored) => {
    const move = planRevisionMove(
      { properties: { field: { type: "string" } } },
      { properties: { field: property } },
      { field: stored },
    );

    expect([...move.review]).toEqual(["field"]);
    expect(move.kept).toEqual({});
  });

  it("requires removing what a closed revision doesn't declare", () => {
    const move = planRevisionMove(
      { properties: { ...NAME, nickname: { type: "string" } } },
      { additionalProperties: false, properties: NAME },
      { givenName: "Ada", nickname: "ada" },
    );

    expect(move.removed).toEqual([
      { name: "nickname", path: ["nickname"], value: "ada", mustRemove: true },
    ]);
  });

  it("leaves removing it optional when the revision is open", () => {
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
      {
        additionalProperties: false,
        properties: { ...NAME, lastName: { type: "string" } },
      },
      { givenName: "Ada", surname: "Lovelace" },
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

describe("storedValueFits", () => {
  it("never judges what no control can write, unless it is missing and required", () => {
    expect(storedValueFits(only({ a: { oneOf: [] } }), { any: "thing" })).toBe(true);
    expect(storedValueFits(only({ a: { oneOf: [] } }, ["a"]), undefined)).toBe(false);
  });

  it("looks inside an object", () => {
    const entry = only({
      a: { type: "object", required: ["b"], properties: { b: { type: "string" } } },
    });

    expect(storedValueFits(entry, { b: "x" })).toBe(true);
    expect(storedValueFits(entry, {})).toBe(false);
    expect(storedValueFits(entry, undefined)).toBe(true);
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

  it("converts a stored string to the number its new type needs", () => {
    // A draft of `"36"` reads the same as the stored `"36"`, and must still be sent.
    const root = rootOver({ age: { type: "integer" } });
    const draft = draftForRevision(root, { age: "36" });
    const age = draft.fields.age ?? "";

    expect(age).toBe("36");
    expect(revisionFieldPatch(only({ age: { type: "integer" } }), age, "36")).toBe(36);
  });

  it("sends nothing for a value that is already what the field would send", () => {
    expect(revisionFieldPatch(only({ a: { type: "string" } }), "x", "x")).toBeUndefined();
  });

  it("deletes a value the form emptied", () => {
    expect(revisionFieldPatch(only({ a: { type: "integer" } }), "", "36")).toBeNull();
    expect(revisionFieldPatch(only({ a: { type: "integer" } }), "", undefined)).toBeUndefined();
  });

  it("starts a value of the wrong shape blank rather than locked", () => {
    const root = rootOver({
      active: { type: "boolean" },
      country: { type: "string", enum: ["CH"] },
    });
    const draft = draftForRevision(root, { active: "yes", country: "Switzerland" });

    expect(draft.fields).toEqual({ active: "", country: "" });
  });

  it("keeps a whole opaque field locked, which nothing here can write", () => {
    const root = rootOver({ a: { oneOf: [{ type: "string" }] } });
    const draft = draftForRevision(root, { a: "x" });

    expect(draft.fields.a).toEqual({ kind: "locked", value: "x" });
    expect(
      revisionFieldPatch(only({ a: { oneOf: [] } }), draft.fields.a ?? "", "x"),
    ).toBeUndefined();
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

describe("canTakeValue", () => {
  it("takes a value of the field's own kind only", () => {
    expect(canTakeValue(only({ a: { type: "string" } }), "x")).toBe(true);
    expect(canTakeValue(only({ a: { type: "string" } }), 1)).toBe(false);
    expect(canTakeValue(only({ a: { type: "number" } }), 1)).toBe(true);
    expect(canTakeValue(only({ a: { type: "boolean" } }), "x")).toBe(false);
    expect(canTakeValue(only({ a: { type: "string", enum: ["x"] } }), "x")).toBe(false);
  });
});
