import { describe, expectTypeOf, it } from "vitest";

import type { FieldPath } from "../../../../../src/lib/oclif/crud";

describe("FieldPath", () => {
  type User = { id: string; metadata: { status: string; created_at?: string }; teams: string[] };

  it("names every field and every field below an object", () => {
    expectTypeOf<FieldPath<User>>().toEqualTypeOf<
      "id" | "metadata" | "metadata.status" | "metadata.created_at" | "teams"
    >();
  });

  it("names nothing inside an array", () => {
    expectTypeOf<"teams.0">().not.toExtend<FieldPath<User>>();
  });

  it("names no field an index signature would let through", () => {
    type Open = { id: string; schema: { objectType: string; [key: string]: unknown } };

    expectTypeOf<FieldPath<Open>>().toEqualTypeOf<"id" | "schema" | "schema.objectType">();
  });

  it("names only the paths every member of a union has", () => {
    type Either = { id: string; updated_at: string } | { id: string };

    expectTypeOf<FieldPath<Either>>().toEqualTypeOf<"id">();
  });

  it("names only the nested paths every member of a union has", () => {
    type Either = { meta: { a: string; only: string } } | { meta: { a: string } };

    expectTypeOf<FieldPath<Either>>().toEqualTypeOf<"meta" | "meta.a">();
  });
});
