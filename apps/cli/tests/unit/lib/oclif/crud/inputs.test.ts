import { describe, expect, it } from "vitest";
import { z } from "zod";

import { describeBody } from "../../../../../src/lib/oclif/crud";
import { documentSchemaOf } from "../../../../../src/lib/oclif/crud/fields";
import {
  fieldsFlag,
  filterFlag,
  setFlag,
  sortFlag,
} from "../../../../../src/lib/oclif/crud/inputs";
import { fieldPaths } from "../../../../../src/lib/oclif/crud/paths";

type Parsing = {
  parse: (input: string, context: unknown, flag: unknown) => Promise<unknown>;
};

const reading = (flag: unknown) => {
  const parsing = flag as Parsing;
  return (input: string) => parsing.parse(input, {}, flag);
};

const FILTERS = [
  {
    field: "status",
    operations: ["equals", "contains"],
    values: ["active", "inactive"],
  },
];

describe("filterFlag", () => {
  const read = reading(
    filterFlag({
      filters: FILTERS,
      operations: ["equals", "contains", "greater_than"],
    }),
  );

  it("reads an entry and keeps the text it was typed as", async () => {
    await expect(read("status=contains:active")).resolves.toMatchObject({
      raw: "status=contains:active",
      operation: "contains",
      value: "active",
    });
  });

  it("refuses a field the list does not declare", async () => {
    await expect(read("nonsense=1")).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: 'Unknown filter field "nonsense"',
    });
  });

  it("refuses a value outside the field's closed set", async () => {
    await expect(read("status=maybe")).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: 'Invalid value "maybe" for filter field "status"',
    });
  });
});

describe("sortFlag", () => {
  const read = reading(sortFlag({ sorts: ["created_at", "name"] }));

  it("reads a field and a direction, defaulting to ascending", async () => {
    await expect(read("name")).resolves.toEqual({
      raw: "name",
      field: "name",
      direction: "asc",
    });
  });

  it("refuses a field the list cannot be sorted by", async () => {
    await expect(read("nmae:desc")).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: 'Unknown sort field "nmae"',
    });
  });

  it("refuses a direction that is neither asc nor desc", async () => {
    await expect(read("name:up")).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: 'Invalid sort direction "up"',
    });
  });
});

describe("fieldsFlag", () => {
  const shape = fieldPaths(z.object({ id: z.string(), name: z.string() }));

  it("splits the columns and trims them", async () => {
    const read = reading(fieldsFlag({ fallback: ["id"], shape }));

    await expect(read(" id , name ")).resolves.toEqual(["id", "name"]);
  });

  it("refuses an empty list, offering the fallback as the example", async () => {
    const read = reading(fieldsFlag({ fallback: ["id", "name"] }));

    await expect(read(" , ")).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: "At least one column is needed",
      hint: "Comma-separated dot-paths, e.g. --fields id,name.",
    });
  });

  it("refuses a column the record's shape cannot carry", async () => {
    const read = reading(fieldsFlag({ fallback: ["id"], shape }));

    await expect(read("id,emial")).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: "No such column: emial",
    });
  });

  it("leaves a column to the records when no shape is known", async () => {
    const read = reading(fieldsFlag({ fallback: ["id"] }));

    await expect(read("anything")).resolves.toEqual(["anything"]);
  });
});

describe("setFlag", () => {
  const schema = z.object({ slug: z.string(), tags: z.array(z.string()) });
  const document = documentSchemaOf(schema, undefined);
  const fields = describeBody(schema);
  const read = reading(setFlag({ document, fields }));

  it("reads an entry against the body's schema", async () => {
    await expect(read("slug=acme")).resolves.toMatchObject({
      name: "slug",
      path: ["slug"],
      value: "acme",
      raw: "slug=acme",
    });
  });

  it("refuses a path the body has no field for", async () => {
    await expect(read("nope=1")).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: "--set nope names no field of this body",
    });
  });

  it("refuses a plain value for a field that takes JSON", async () => {
    await expect(read("tags=a")).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: "--set tags names a list, which takes JSON",
    });
  });
});
