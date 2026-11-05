import { describe, expect, it } from "vitest";
import { z } from "zod";

import { chosenColumns, readColumns } from "@/lib/oclif/crud/columns";
import { fieldPaths } from "@/lib/oclif/crud/paths";

describe("readColumns", () => {
  it("drops blanks between commas", () => {
    expect(readColumns("id,, name", ["id"])).toEqual(["id", "name"]);
  });
});

describe("chosenColumns", () => {
  const shape = fieldPaths(z.object({ id: z.string() }));

  it("falls back to the resource's own columns when none were chosen", () => {
    expect(chosenColumns(undefined, ["id"], [])).toEqual(["id"]);
  });

  it("trusts a choice the shape already judged, whatever the records hold", () => {
    expect(chosenColumns(["id"], ["name"], [{ other: 1 }], shape)).toEqual(["id"]);
  });

  it("judges a choice by the records in hand when there is no shape", () => {
    expect(() => chosenColumns(["emial"], ["id"], [{ id: "1", email: "a@b.c" }])).toThrow(
      "No such column: emial",
    );
  });

  it("accepts any choice when there is no shape and no record to judge by", () => {
    expect(chosenColumns(["anything"], ["id"], [])).toEqual(["anything"]);
  });
});
