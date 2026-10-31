import { describe, expectTypeOf, it } from "vitest";

import type { FieldPath, ListItem, ListPage } from "../../../../../src/lib/oclif/crud";

describe("ListPage", () => {
  it("takes a page holding its list under the named field", () => {
    expectTypeOf<{ users: string[]; next_page_token?: string }>().toExtend<ListPage<"users">>();
  });

  it("refuses a page without the named field", () => {
    expectTypeOf<{ users: string[] }>().not.toExtend<ListPage<"user">>();
  });

  it("refuses a named field that is not a list", () => {
    expectTypeOf<{ users: string[]; next_page_token: string }>().not.toExtend<
      ListPage<"next_page_token">
    >();
  });

  it("takes the array itself when no field is named", () => {
    expectTypeOf<string[]>().toExtend<ListPage<undefined>>();
  });

  it("refuses a wrapped page when no field is named", () => {
    expectTypeOf<{ users: string[] }>().not.toExtend<ListPage<undefined>>();
  });
});

describe("ListItem", () => {
  it("is an entry of the list the named field holds", () => {
    expectTypeOf<ListItem<{ users: { id: string }[] }, "users">>().toEqualTypeOf<{ id: string }>();
  });

  it("is an entry of the page itself when no field is named", () => {
    expectTypeOf<ListItem<{ id: string }[], undefined>>().toEqualTypeOf<{ id: string }>();
  });
});

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
});
