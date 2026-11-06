import { describe, expect, it } from "vitest";

import {
  type ArrayField,
  type SchemaField,
  schemaFields,
  schemaFlatFields,
} from "@/features/schemas/model";
import {
  type ArrayDraft,
  attributesPatch,
  type Draft,
  draftFromAttributes,
  draftValue,
  filledCount,
  fieldHints,
  formRoot,
  newDraft,
  newRow,
  type ObjectDraft,
  pathOfNamedField,
  unwritableMessage,
  unwritableRequired,
  validateDraft,
} from "./schema-form";

function only(properties: Record<string, unknown>, required: string[] = []): SchemaField {
  const [entry] = schemaFields({ properties, required });
  if (!entry) throw new Error("no field");
  return entry;
}

/** A form over a schema, with one value at a time written into its draft. */
function formOver(properties: Record<string, unknown>, required: string[] = []) {
  const root = formRoot(schemaFields({ properties, required }));
  return { root, draft: newDraft(root) };
}

function withValue(draft: ObjectDraft, key: string, value: ObjectDraft["fields"][string]) {
  return { ...draft, fields: { ...draft.fields, [key]: value } };
}

describe("schemaFields", () => {
  it.each([
    [["string", "null"], "text", false],
    [["integer", "null"], "number", true],
    [["number", "null"], "number", false],
    [["boolean", "null"], "boolean", false],
  ])("reads the union %j as its real type, nullable", (type, inputType, integer) => {
    expect(only({ a: { type } })).toMatchObject({
      kind: "value",
      nullable: true,
      inputType,
      integer,
    });
  });

  it("treats a nullable object as an object", () => {
    const field = only({ a: { type: ["object", "null"], properties: { b: { type: "string" } } } });
    expect(field).toMatchObject({ kind: "object", nullable: true });
  });

  it.each([
    ["a mixed union", { type: ["string", "integer"] }],
    ["null alone", { type: "null" }],
    ["oneOf", { oneOf: [{ type: "string" }] }],
    ["a free-form object", { type: "object" }],
    ["a tuple", { type: "array", prefixItems: [{ type: "string" }], items: { type: "string" } }],
    ["an array with no items", { type: "array" }],
    ["an array of a mixed union", { type: "array", items: { type: ["string", "integer"] } }],
    ["an enum of objects", { enum: [{ a: 1 }] }],
  ])("has no control for %s", (_, property) => {
    expect(only({ a: property }).kind).toBe("opaque");
  });

  it("keeps an enum's values in their JSON types, with `null` as nullable", () => {
    expect(only({ a: { enum: [1, "1", null] } })).toMatchObject({
      options: [1, "1"],
      nullable: true,
    });
  });

  it("trims what surrounding spaces would break, and no free text", () => {
    const schema = {
      "x-identifier": "contact.handle",
      properties: {
        bio: { type: "string" },
        id: { type: "string", format: "uuid" },
        contact: { type: "object", properties: { handle: { type: "string" } } },
      },
    };
    const [bio, contact, id] = schemaFields(schema);
    expect(bio).toMatchObject({ key: "bio", trim: false });
    expect(id).toMatchObject({ key: "id", trim: true });
    expect(contact?.kind === "object" && contact.fields[0]).toMatchObject({ trim: true });
  });
});

describe("schemaFlatFields", () => {
  it("offers no object as a column, nullable or free-form", () => {
    const columns = schemaFlatFields({
      properties: {
        email: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        a: { type: "object" },
        b: { type: ["object", "null"], properties: { c: { type: "string" } } },
      },
    });
    expect(columns.map((column) => column.key)).toEqual(["email", "tags"]);
  });
});

describe("draftValue", () => {
  it("omits what is empty, and keeps free text exactly as typed", () => {
    const { root, draft } = formOver({ bio: { type: "string" }, nick: { type: "string" } });
    const typed = withValue(draft, "bio", "  spaced  ");
    expect(draftValue(root, typed, "create")).toEqual({ bio: "  spaced  " });
  });

  it("answers a required nullable property with `null` on create", () => {
    const { root, draft } = formOver({ a: { type: ["integer", "null"] } }, ["a"]);
    expect(draftValue(root, draft, "create")).toEqual({ a: null });
  });

  it("sends a required switch left off as `false`, and an optional one not at all", () => {
    const { root, draft } = formOver({ a: { type: "boolean" }, b: { type: "boolean" } }, ["a"]);
    expect(draftValue(root, draft, "create")).toEqual({ a: false });
  });

  it("restores an enum's JSON type", () => {
    const { root, draft } = formOver({ a: { enum: [1, "1", true] } });
    expect(draftValue(root, withValue(draft, "a", "1"), "create")).toEqual({ a: 1 });
    expect(draftValue(root, withValue(draft, "a", '"1"'), "create")).toEqual({ a: "1" });
    expect(draftValue(root, withValue(draft, "a", "true"), "create")).toEqual({ a: true });
  });

  it("drops blank rows, and keeps an off switch in a list of booleans", () => {
    const strings = formOver({ a: { type: "array", items: { type: "string" } } });
    const { root, draft } = strings;
    const rows = [
      { id: -1, draft: "x" },
      { id: -2, draft: "" },
    ];
    expect(draftValue(root, withValue(draft, "a", { kind: "array", rows }), "create")).toEqual({
      a: ["x"],
    });

    const flags = formOver({ a: { type: "array", items: { type: "boolean" } } });
    const flagRows = [{ id: -3, draft: "false" }];
    expect(
      draftValue(
        flags.root,
        withValue(flags.draft, "a", { kind: "array", rows: flagRows }),
        "create",
      ),
    ).toEqual({ a: [false] });
  });

  it("prefills a default on create, but not inside an optional object", () => {
    const root = formRoot(
      schemaFields({
        required: ["top"],
        properties: {
          top: { type: "string", default: "x" },
          plan: { enum: ["a", "b"], default: "b" },
          wrong: { type: "boolean", default: "nope" },
          group: { type: "object", properties: { inner: { type: "string", default: "y" } } },
        },
      }),
    );
    expect(draftValue(root, newDraft(root), "create")).toEqual({ top: "x", plan: "b" });
  });
});

describe("attributesPatch", () => {
  const root = formRoot(
    schemaFields({
      properties: {
        flag: { type: "boolean" },
        tags: { type: "array", items: { type: "string" } },
        address: {
          type: "object",
          properties: { city: { type: "string" }, street: { type: "string" } },
        },
      },
    }),
  );

  it("is empty for what was stored, whatever its shape", () => {
    const stored = draftFromAttributes(root, {
      tags: ["a"],
      address: { city: "Bern", extra: { kept: true } },
      flag: false,
    });
    expect(attributesPatch(root, stored, stored)).toEqual({});
  });

  it("reads an absent switch toggled back off as no change", () => {
    const stored = draftFromAttributes(root, {});
    expect(attributesPatch(root, stored, withValue(stored, "flag", "false"))).toEqual({});
    const turnedOff = draftFromAttributes(root, { flag: true });
    expect(attributesPatch(root, turnedOff, withValue(turnedOff, "flag", "false"))).toEqual({
      flag: false,
    });
  });

  it("deletes an object whose fields were all emptied", () => {
    const stored = draftFromAttributes(root, { address: { city: "Bern" } });
    const emptied = withValue(stored, "address", {
      kind: "object",
      fields: { city: "", street: "" },
      rest: {},
    });
    expect(attributesPatch(root, stored, emptied)).toEqual({ address: null });
  });

  it("locks a stored value of the wrong shape, and writes nothing for it", () => {
    const stored = draftFromAttributes(root, { address: "Bern", tags: [{ a: 1 }], flag: "yes" });
    for (const key of ["address", "tags", "flag"]) {
      expect(stored.fields[key]).toMatchObject({ kind: "locked" });
    }
    expect(attributesPatch(root, stored, stored)).toEqual({});
  });
});

describe("validateDraft", () => {
  function errorOf(property: Record<string, unknown>, value: string) {
    const { root, draft } = formOver({ a: property });
    return validateDraft(root, withValue(draft, "a", value), "create").get("a");
  }

  it.each([
    [{ type: "integer" }, "1.5", "Enter a whole number."],
    [{ type: "number" }, "abc", "Enter a number."],
    [{ type: "integer", minimum: 2 }, "1", "Enter 2 or more."],
    [{ type: "integer", maximum: 2 }, "3", "Enter 2 or less."],
    [{ type: "number", exclusiveMinimum: 2 }, "2", "Enter more than 2."],
    [{ type: "number", exclusiveMaximum: 2 }, "2", "Enter less than 2."],
    [{ type: "number", multipleOf: 5 }, "7", "Enter a multiple of 5."],
    [{ type: "string", minLength: 3 }, "ab", "Enter at least 3 characters."],
    [{ type: "string", maxLength: 1 }, "ab", "Enter at most 1 character."],
    [{ type: "string", pattern: "^a" }, "b", "Must match ^a."],
    [{ type: "string", format: "uuid" }, "nope", "Enter a UUID."],
    [
      { type: "string", format: "email" },
      "A <a@b>",
      "Enter one email address, like name@example.com.",
    ],
    [
      { type: "string", format: "email" },
      "nope",
      "Enter one email address, like name@example.com.",
    ],
  ])("refuses for %j the value %s", (property, value, message) => {
    expect(errorOf(property, value)).toBe(message);
  });

  it.each([
    // Valid to the server, so never refused here.
    [{ type: "string", format: "email" }, "a@b"],
    [{ type: "string", format: "email" }, "é@ü.example"],
    [{ type: "string", format: "email" }, '"a b"@example.com'],
    // Annotations, or ones the server is left to explain.
    [{ type: "string", format: "url" }, "not a url"],
    [{ type: "string", format: "date-time" }, "soon"],
    [{ type: "number", multipleOf: 0.1 }, "0.3"],
    // Length is counted in code points: one emoji, one character.
    [{ type: "string", maxLength: 1 }, "😀"],
    // A pattern this engine cannot read is not this engine's to enforce.
    [{ type: "string", pattern: "(?<" }, "anything"],
  ])("accepts for %j the value %s", (property, value) => {
    expect(errorOf(property, value)).toBeUndefined();
  });

  it("does not re-judge a stored value, only a changed one", () => {
    const { root } = formOver({ a: { type: "string", format: "email" } });
    const stored = draftFromAttributes(root, { a: "not-an-email" });
    expect(validateDraft(root, stored, "edit", stored).size).toBe(0);
    const changed = withValue(stored, "a", "also-not");
    expect(validateDraft(root, changed, "edit", stored).get("a")).toBeDefined();
  });

  it("still says a stored user lacks a required value, as the server will", () => {
    const { root } = formOver({ a: { type: "string" } }, ["a"]);
    const stored = draftFromAttributes(root, {});
    expect(validateDraft(root, stored, "edit", stored).get("a")).toBe("This field is required.");
  });

  it("lets a stored `null` stand on edit, but not clearing a value to delete it", () => {
    const { root, draft } = formOver({ a: { type: ["string", "null"] } }, ["a"]);
    expect(validateDraft(root, draft, "create").size).toBe(0);
    const storedNull = draftFromAttributes(root, { a: null });
    expect(validateDraft(root, storedNull, "edit", storedNull).size).toBe(0);
    const stored = draftFromAttributes(root, { a: "x" });
    const cleared = withValue(stored, "a", "");
    expect(validateDraft(root, cleared, "edit", stored).get("a")).toBe("This field is required.");
  });

  it("requires an optional object's fields only once it has a value", () => {
    const { root, draft } = formOver({
      address: {
        type: "object",
        required: ["city"],
        properties: { city: { type: "string" }, street: { type: "string" } },
      },
    });
    expect(validateDraft(root, draft, "create").size).toBe(0);
    const started = withValue(draft, "address", {
      kind: "object",
      fields: { city: "", street: "Main" },
      rest: {},
    });
    expect(validateDraft(root, started, "create").get("address.city")).toBe(
      "This field is required.",
    );
  });

  it("counts and compares only the rows that hold something", () => {
    const { root, draft } = formOver({
      a: { type: "array", items: { type: "string" }, minItems: 2, uniqueItems: true },
    });
    const rows = (...values: string[]) => ({
      kind: "array" as const,
      rows: values.map((value, index) => ({ id: index, draft: value })),
    });
    expect(validateDraft(root, withValue(draft, "a", rows("x", "")), "create").get("a")).toBe(
      "Add at least 2 items.",
    );
    expect(validateDraft(root, withValue(draft, "a", rows("x", "x")), "create").get("a")).toBe(
      "Each item must be different.",
    );
    expect(validateDraft(root, withValue(draft, "a", rows("x", "y")), "create").size).toBe(0);
  });
});

describe("unwritableRequired", () => {
  const opaque = { oneOf: [{ type: "string" }], title: "Contact" };

  it("names a required property with no control, nested too", () => {
    const { root, draft } = formOver(
      {
        contact: opaque,
        group: { type: "object", required: ["inner"], properties: { inner: opaque } },
      },
      ["contact", "group"],
    );
    expect(unwritableRequired(root, draft, "create")).toEqual(["Contact", "Contact"]);
  });

  it("ignores one inside an optional object that is left empty", () => {
    const { root, draft } = formOver({
      group: { type: "object", required: ["inner"], properties: { inner: opaque } },
    });
    expect(unwritableRequired(root, draft, "create")).toEqual([]);
  });
});

describe("pathOfNamedField", () => {
  it("finds a nested field, and a row by its index among those sent", () => {
    const { root } = formOver({
      address: { type: "object", properties: { city: { type: "string" } } },
      tags: { type: "array", items: { type: "string" } },
    });
    const draft = withValue(newDraft(root), "tags", {
      kind: "array",
      rows: [
        { id: 7, draft: "" },
        { id: 8, draft: "x" },
      ],
    });
    expect(pathOfNamedField(root, draft, "address.city")).toBe("address.city");
    expect(pathOfNamedField(root, draft, "tags.0")).toBe("tags.#8");
    expect(pathOfNamedField(root, draft, "tags.5")).toBe("tags");
    expect(pathOfNamedField(root, draft, "nope")).toBeUndefined();
  });
});

describe("fieldHints", () => {
  it("leads with the description, then only rules the control does not show", () => {
    expect(
      fieldHints(only({ a: { type: "string", description: "Why.", minLength: 2, maxLength: 4 } })),
    ).toEqual(["Why.", "2 to 4 characters."]);
    expect(fieldHints(only({ a: { type: "string", format: "email" } }))).toEqual([]);
    expect(fieldHints(only({ a: { type: "string", format: "uuid" } }))).toEqual(["Format: uuid."]);
    expect(fieldHints(only({ a: { enum: ["x"], description: "Why." } }))).toEqual(["Why."]);
    expect(fieldHints(only({ a: { type: "integer", minimum: 1, maximum: 2 } }))).toEqual([
      "Between 1 and 2.",
    ]);
  });

  it("speaks for an array and its items together", () => {
    const field = only({
      a: {
        type: "array",
        description: "Tags.",
        minItems: 1,
        maxItems: 3,
        items: { type: "string", maxLength: 8 },
      },
    }) as ArrayField;
    expect(fieldHints(field)).toEqual(["Tags.", "1 to 3 items.", "Up to 8 characters."]);
  });
});

/** A stored user's form, and the draft after one row of an array is rewritten. */
function editedRow(
  properties: Record<string, unknown>,
  attributes: Record<string, unknown>,
  key: string,
  index: number,
  edit: (row: Draft) => Draft,
) {
  const { root } = formOver(properties);
  const stored = draftFromAttributes(root, attributes);
  const array = stored.fields[key] as ArrayDraft;
  const rows = array.rows.map((row, at) =>
    at === index ? { ...row, draft: edit(row.draft) } : row,
  );
  return { root, stored, draft: withValue(stored, key, { kind: "array", rows }) };
}

function withChild(row: Draft, key: string, value: string): Draft {
  const object = row as ObjectDraft;
  return { ...object, fields: { ...object.fields, [key]: value } };
}

describe("stored array rows round-trip", () => {
  const onOrName = {
    type: "array",
    items: { type: "object", properties: { on: { type: "boolean" }, n: { type: "string" } } },
  };

  it("keeps a row holding only `false` when another row is edited", () => {
    const { root, stored, draft } = editedRow(
      { items: onOrName },
      { items: [{ on: false }, { n: "a" }] },
      "items",
      1,
      (row) => withChild(row, "n", "b"),
    );
    expect(attributesPatch(root, stored, draft)).toEqual({
      items: [{ on: false }, { n: "b" }],
    });
  });

  it("writes every row when a switch is turned off, never `null`", () => {
    const { root, stored, draft } = editedRow(
      { flags: onOrName },
      { flags: [{ on: false }, { on: true }, { on: false }] },
      "flags",
      1,
      (row) => withChild(row, "on", "false"),
    );
    expect(attributesPatch(root, stored, draft)).toEqual({
      flags: [{ on: false }, { on: false }, { on: false }],
    });
  });

  it("keeps `null` and empty rows exactly where they were", () => {
    const { root, stored, draft } = editedRow(
      { tags: { type: "array", items: { type: ["string", "null"] } } },
      { tags: ["a", null, "", "b"] },
      "tags",
      0,
      () => "z",
    );
    expect(attributesPatch(root, stored, draft)).toEqual({ tags: ["z", null, "", "b"] });
  });

  const nullableChild = {
    type: "array",
    items: {
      type: "object",
      required: ["a"],
      properties: { a: { type: ["string", "null"] }, b: { type: "string" } },
    },
  };

  it("keeps a required `null` in the row beside the edit, and in the edited row", () => {
    const attributes = {
      xs: [
        { a: null, b: "1" },
        { a: "q", b: "2" },
      ],
    };
    const beside = editedRow({ xs: nullableChild }, attributes, "xs", 1, (row) =>
      withChild(row, "b", "3"),
    );
    expect(attributesPatch(beside.root, beside.stored, beside.draft)).toEqual({
      xs: [
        { a: null, b: "1" },
        { a: "q", b: "3" },
      ],
    });
    const within = editedRow({ xs: nullableChild }, attributes, "xs", 0, (row) =>
      withChild(row, "b", "9"),
    );
    expect(attributesPatch(within.root, within.stored, within.draft)).toEqual({
      xs: [
        { a: null, b: "9" },
        { a: "q", b: "2" },
      ],
    });
  });

  it("keeps undeclared keys of a row it edits", () => {
    const { root, stored, draft } = editedRow(
      { items: onOrName },
      { items: [{ n: "a", legacy: 1 }] },
      "items",
      0,
      (row) => withChild(row, "n", "b"),
    );
    expect(attributesPatch(root, stored, draft)).toEqual({ items: [{ n: "b", legacy: 1 }] });
  });

  it("drops only a new row nobody filled in, and a cleared stored row asks for removal", () => {
    const tags = { type: "array", items: { type: "string" } };
    const { root } = formOver({ tags });
    const field = root.fields[0] as ArrayField;
    const stored = draftFromAttributes(root, { tags: ["a"] });
    const array = stored.fields.tags as ArrayDraft;
    const added = withValue(stored, "tags", {
      kind: "array",
      rows: [...array.rows, newRow(field)],
    });
    expect(attributesPatch(root, stored, added)).toEqual({});
    expect(validateDraft(root, added, "edit", stored).size).toBe(0);

    const cleared = editedRow({ tags }, { tags: ["a", "b"] }, "tags", 0, () => "");
    const errors = validateDraft(cleared.root, cleared.draft, "edit", cleared.stored);
    expect([...errors.values()]).toEqual(["This field is required."]);
  });

  it("does not judge an untouched row, but judges an edited one", () => {
    const tags = { type: "array", items: { type: "string", maxLength: 1 } };
    const { root } = formOver({ tags });
    const stored = draftFromAttributes(root, { tags: ["", "toolong"] });
    expect(validateDraft(root, stored, "edit", stored).size).toBe(0);
    const edited = editedRow({ tags }, { tags: ["", "toolong"] }, "tags", 1, () => "stilltoolong");
    expect([...validateDraft(edited.root, edited.draft, "edit", edited.stored).values()]).toEqual([
      "Enter at most 1 character.",
    ]);
  });

  it("does not ask a new row's required nullable child for an answer", () => {
    const { root } = formOver({ xs: nullableChild });
    const field = root.fields[0] as ArrayField;
    const stored = draftFromAttributes(root, { xs: [{ a: "q" }] });
    const array = stored.fields.xs as ArrayDraft;
    const row = newRow(field);
    const added = withValue(stored, "xs", {
      kind: "array",
      rows: [...array.rows, { ...row, draft: withChild(row.draft, "b", "2") }],
    });
    expect(validateDraft(root, added, "edit", stored).size).toBe(0);
    expect(attributesPatch(root, stored, added)).toEqual({
      xs: [{ a: "q" }, { a: null, b: "2" }],
    });
  });
});

describe("boolean arrays", () => {
  const flags = { type: "array", minItems: 1, items: { type: "boolean" } };

  it("sends nothing for an optional one nobody touched", () => {
    const { root, draft } = formOver({ flags });
    expect(draftValue(root, draft, "create")).toEqual({});
    expect(validateDraft(root, draft, "create").size).toBe(0);
  });

  it("starts a new row as a real `false`, which counts towards `minItems`", () => {
    const { root, draft } = formOver({ flags }, ["flags"]);
    expect(validateDraft(root, draft, "create").size).toBe(0);
    expect(draftValue(root, draft, "create")).toEqual({ flags: [false] });
  });

  it("gives a new object row's required switch its `false`, not an optional one", () => {
    const { root } = formOver({
      xs: {
        type: "array",
        items: {
          type: "object",
          required: ["on"],
          properties: { on: { type: "boolean" }, maybe: { type: "boolean" } },
        },
      },
    });
    const row = newRow(root.fields[0] as ArrayField);
    const draft = withValue(newDraft(root), "xs", { kind: "array", rows: [row] });
    expect(draftValue(root, draft, "create")).toEqual({ xs: [{ on: false }] });
  });
});

describe("emptied objects", () => {
  const nick = { type: "object", properties: { nick: { type: "string" } } };

  function cleared(properties: Record<string, unknown>, stored: Record<string, unknown>) {
    const { root } = formOver(properties, Object.keys(properties));
    return { root, stored: draftFromAttributes(root, stored) };
  }

  it("patches a required object per key, never `null`", () => {
    const { root, stored } = cleared({ settings: nick }, { settings: { nick: "m" } });
    const draft = withValue(
      stored,
      "settings",
      withChild(stored.fields.settings as Draft, "nick", ""),
    );
    expect(attributesPatch(root, stored, draft)).toEqual({ settings: { nick: null } });
  });

  it("writes a switch turned off rather than deleting its object", () => {
    const prefs = { type: "object", required: ["on"], properties: { on: { type: "boolean" } } };
    const { root } = formOver({ prefs });
    const stored = draftFromAttributes(root, { prefs: { on: true } });
    const draft = withValue(
      stored,
      "prefs",
      withChild(stored.fields.prefs as Draft, "on", "false"),
    );
    expect(attributesPatch(root, stored, draft)).toEqual({ prefs: { on: false } });
  });

  const addr = {
    type: "object",
    properties: { city: { type: "string" }, verified: { type: "boolean" } },
  };

  it("keeps a stored `false` when the object's other value is cleared", () => {
    const { root } = formOver({ addr });
    const stored = draftFromAttributes(root, { addr: { city: "x", verified: false } });
    const draft = withValue(stored, "addr", withChild(stored.fields.addr as Draft, "city", ""));
    expect(attributesPatch(root, stored, draft)).toEqual({ addr: { city: null } });
  });

  it("keeps undeclared keys when every declared one is cleared", () => {
    const { root } = formOver({ addr });
    const stored = draftFromAttributes(root, { addr: { city: "x", legacy: 1 } });
    const draft = withValue(stored, "addr", withChild(stored.fields.addr as Draft, "city", ""));
    expect(attributesPatch(root, stored, draft)).toEqual({ addr: { city: null } });
  });

  it("deletes an optional object only when nothing is left in it", () => {
    const { root } = formOver({ addr });
    const stored = draftFromAttributes(root, { addr: { city: "x" } });
    const draft = withValue(stored, "addr", withChild(stored.fields.addr as Draft, "city", ""));
    expect(attributesPatch(root, stored, draft)).toEqual({ addr: null });
  });
});

describe("a required switch left absent", () => {
  const properties = {
    name: { type: "string" },
    terms: { type: "boolean" },
    vip: { type: "boolean" },
  };

  it("is written as `false` by a save that writes its level, an optional one not", () => {
    const { root } = formOver(properties, ["terms"]);
    const stored = draftFromAttributes(root, {});
    expect(attributesPatch(root, stored, withValue(stored, "name", "m"))).toEqual({
      name: "m",
      terms: false,
    });
  });

  it("is not a change by itself", () => {
    const { root } = formOver(properties, ["terms"]);
    const stored = draftFromAttributes(root, {});
    expect(attributesPatch(root, stored, stored)).toEqual({});
  });

  it("does not overwrite what is stored", () => {
    const { root } = formOver(properties, ["terms"]);
    const stored = draftFromAttributes(root, { terms: true });
    expect(attributesPatch(root, stored, withValue(stored, "name", "m"))).toEqual({ name: "m" });
  });

  it("fills a nested level the save writes, and a required object beside the write", () => {
    const group = {
      type: "object",
      required: ["on"],
      properties: { on: { type: "boolean" }, x: { type: "string" } },
    };
    const { root } = formOver({ group, name: { type: "string" }, other: group }, ["other"]);
    const stored = draftFromAttributes(root, {});
    const draft = withValue(
      withValue(stored, "name", "m"),
      "group",
      withChild(stored.fields.group as Draft, "x", "y"),
    );
    expect(attributesPatch(root, stored, draft)).toEqual({
      group: { on: false, x: "y" },
      name: "m",
      other: { on: false },
    });
  });

  it("still sends `false` on create, and leaves an unstarted optional object out", () => {
    const { root, draft } = formOver(
      {
        terms: { type: "boolean" },
        vip: { type: "boolean" },
        group: { type: "object", required: ["on"], properties: { on: { type: "boolean" } } },
      },
      ["terms"],
    );
    expect(draftValue(root, draft, "create")).toEqual({ terms: false });
  });
});

describe("unwritableRequired, beyond a top-level property", () => {
  const opaque = { title: "Contact", oneOf: [{ type: "string" }] };

  it("finds it in the items of a required array that must have one", () => {
    const { root, draft } = formOver(
      {
        xs: {
          type: "array",
          minItems: 1,
          items: { type: "object", required: ["c"], properties: { c: opaque } },
        },
      },
      ["xs"],
    );
    expect(unwritableRequired(root, draft, "create")).toEqual(["Contact"]);
  });

  it("ignores it in an optional array left empty", () => {
    const { root, draft } = formOver({
      xs: { type: "array", items: { type: "object", required: ["c"], properties: { c: opaque } } },
    });
    expect(unwritableRequired(root, draft, "create")).toEqual([]);
  });

  it("names a required key the schema declares no property for, in the document only", () => {
    const schema = { required: ["ghost"], properties: { a: { type: "string" } } };
    const root = formRoot(schemaFields(schema));
    expect(unwritableRequired(root, newDraft(root), "create")).toEqual(["Ghost"]);
    expect(schemaFlatFields(schema).map((entry) => entry.key)).toEqual(["a"]);
  });

  it("names one absent on edit, but not one that is stored, even as `null`", () => {
    const { root } = formOver({ c: opaque }, ["c"]);
    expect(unwritableRequired(root, draftFromAttributes(root, {}), "edit")).toEqual(["Contact"]);
    expect(unwritableRequired(root, draftFromAttributes(root, { c: "x" }), "edit")).toEqual([]);
    expect(unwritableRequired(root, draftFromAttributes(root, { c: null }), "edit")).toEqual([]);
  });

  it("says each name once", () => {
    expect(unwritableMessage(["Contact", "Contact"], "add this user")).toBe(
      "This schema requires Contact, which this form can’t set. Use the CLI or API to add this user.",
    );
    expect(unwritableMessage([], "add this user")).toBeUndefined();
  });
});

describe("review: nullability", () => {
  it("leaves a stored `null` in a required nullable switch alone on an unrelated save", () => {
    const { root } = formOver({ name: { type: "string" }, active: { type: ["boolean", "null"] } }, [
      "active",
    ]);
    const stored = draftFromAttributes(root, { name: "old", active: null });
    expect(attributesPatch(root, stored, withValue(stored, "name", "new"))).toEqual({
      name: "new",
    });
    // Truly absent is another matter: the server checks `required`, and `null` deletes.
    const absent = draftFromAttributes(root, { name: "old" });
    expect(attributesPatch(root, absent, withValue(absent, "name", "new"))).toEqual({
      name: "new",
      active: false,
    });
  });

  it("does the same inside a nested level the save writes", () => {
    const group = {
      type: "object",
      required: ["on"],
      properties: { on: { type: ["boolean", "null"] }, x: { type: "string" } },
    };
    const { root } = formOver({ group });
    const stored = draftFromAttributes(root, { group: { on: null, x: "a" } });
    const draft = withValue(stored, "group", withChild(stored.fields.group as Draft, "x", "b"));
    expect(attributesPatch(root, stored, draft)).toEqual({ group: { x: "b" } });
  });

  it("sends a required array's blank nullable row as `null`, to reach `minItems`", () => {
    const tags = { type: "array", minItems: 1, items: { type: ["string", "null"] } };
    const { root, draft } = formOver({ tags }, ["tags"]);
    expect(validateDraft(root, draft, "create").size).toBe(0);
    expect(draftValue(root, draft, "create")).toEqual({ tags: [null] });
  });

  it("pads only as far as `minItems`, and still drops a blank row beyond it", () => {
    const tags = { type: "array", minItems: 2, items: { type: ["string", "null"] } };
    const { root } = formOver({ tags }, ["tags"]);
    const field = root.fields[0] as ArrayField;
    const blank = () => newRow(field);
    const filled = { ...blank(), draft: "x" };
    const rows = [filled, blank(), blank()];
    const draft = withValue(newDraft(root), "tags", { kind: "array", rows });
    expect(draftValue(root, draft, "create")).toEqual({ tags: ["x", null] });
  });

  it("does not pad a non-nullable item, or an optional array nobody started", () => {
    const strict = formOver({ tags: { type: "array", minItems: 1, items: { type: "string" } } }, [
      "tags",
    ]);
    expect([...validateDraft(strict.root, strict.draft, "create").entries()]).toEqual([
      [expect.stringMatching(/^tags\.#/), "This field is required."],
    ]);
    const optional = formOver({
      tags: { type: "array", minItems: 1, items: { type: ["string", "null"] } },
    });
    const field = optional.root.fields[0] as ArrayField;
    const draft = withValue(optional.draft, "tags", { kind: "array", rows: [newRow(field)] });
    expect(draftValue(optional.root, draft, "create")).toEqual({});
  });

  it("does not call an empty required nullable object unwritable on create", () => {
    const opaque = { title: "Contact", oneOf: [{ type: "string" }] };
    const group = {
      type: ["object", "null"],
      required: ["c"],
      properties: { c: opaque },
    };
    const { root, draft } = formOver({ group }, ["group"]);
    expect(unwritableRequired(root, draft, "create")).toEqual([]);
    expect(draftValue(root, draft, "create")).toEqual({ group: null });
  });

  it("does not call an empty required nullable array unwritable on create", () => {
    const opaque = { title: "Contact", oneOf: [{ type: "string" }] };
    const xs = {
      type: ["array", "null"],
      minItems: 1,
      items: { type: "object", required: ["c"], properties: { c: opaque } },
    };
    const { root, draft } = formOver({ xs }, ["xs"]);
    expect(unwritableRequired(root, draft, "create")).toEqual([]);
    expect(draftValue(root, draft, "create")).toEqual({ xs: null });
  });

  it("calls them unwritable once started, or on edit when absent, not when stored `null`", () => {
    const opaque = { title: "Contact", oneOf: [{ type: "string" }] };
    const group = {
      type: ["object", "null"],
      required: ["c"],
      properties: { c: opaque, x: { type: "string" } },
    };
    const { root, draft } = formOver({ group }, ["group"]);
    const started = withValue(draft, "group", withChild(draft.fields.group as Draft, "x", "y"));
    expect(unwritableRequired(root, started, "create")).toEqual(["Contact"]);
    expect(unwritableRequired(root, draftFromAttributes(root, {}), "edit")).toEqual(["Contact"]);
    expect(unwritableRequired(root, draftFromAttributes(root, { group: null }), "edit")).toEqual(
      [],
    );
  });

  it.each([
    ["a nullable type with no null in the enum", ["string", "null"], ["free", "paid"], false],
    ["a null in the enum the type excludes", "string", ["free", null], false],
    ["both allowing null", ["string", "null"], ["free", null], true],
    ["no type, and a null in the enum", undefined, ["free", null], true],
  ])("reads nullability from both type and enum: %s", (_, type, allowed, nullable) => {
    const field = only({ a: { ...(type ? { type } : {}), enum: allowed } }, ["a"]);
    expect(field).toMatchObject({
      kind: "value",
      nullable,
      options: allowed.filter((member) => member !== null),
    });
  });

  it("does not send `null` to a required enum that refuses it", () => {
    const { root, draft } = formOver(
      { plan: { type: ["string", "null"], enum: ["free", "paid"] } },
      ["plan"],
    );
    expect(validateDraft(root, draft, "create").get("plan")).toBe("This field is required.");
    expect(draftValue(root, draft, "create")).toEqual({});
  });
});

describe("filledCount", () => {
  it("counts neither a stored `null` nor an array of blank rows as set", () => {
    const form = formOver({
      misc: { oneOf: [{ type: "string" }] },
      tags: { type: "array", items: { type: "string" } },
      nick: { type: "string" },
    });
    const tags = form.root.fields.find((entry) => entry.key === "tags") as ArrayField;
    const blank = withValue(
      withValue(form.draft, "misc", { kind: "locked", value: null }),
      "tags",
      { kind: "array", rows: [newRow(tags)] },
    );
    expect(filledCount(form.root, blank)).toBe(0);
    expect(filledCount(form.root, withValue(blank, "nick", "mo"))).toBe(1);
  });
});
