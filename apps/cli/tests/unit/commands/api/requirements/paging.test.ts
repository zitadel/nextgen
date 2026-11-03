import { describe, expect, it } from "vitest";

import { resolveTarget } from "../../../../../src/lib/api/operations";
import { pagesOperation } from "../../../../../src/commands/api/requirements/paging";

describe("pagesOperation", () => {
  it("holds when --paginate is not given", () => {
    expect(pagesOperation(resolveTarget("getProject"), false)).toBe(true);
  });

  it("holds while the operation is still to be chosen", () => {
    expect(pagesOperation(undefined, true)).toBe(true);
  });

  it("holds for an operation that has a cursor to follow", () => {
    expect(pagesOperation(resolveTarget("queryUsers"), true)).toBe(true);
  });

  it("is broken for an operation that does not page", () => {
    expect(pagesOperation(resolveTarget("getProject"), true)).toBe(false);
  });
});
