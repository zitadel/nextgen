import { describe, expectTypeOf, it } from "vitest";

import type { ListPage } from "../../../../../src/lib/oclif/crud";

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
