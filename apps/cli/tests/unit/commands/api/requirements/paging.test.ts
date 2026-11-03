import { describe, expect, it } from "vitest";

import { apiPaging } from "../../../../../src/commands/api/requirements/paging";
import { resolveTarget } from "../../../../../src/lib/api/operations";
import { requirementContext } from "../../../../helpers/requirement-context";

function paging(operation: string | undefined, paginate: boolean) {
  return apiPaging.resolve(
    requirementContext({
      flags: {
        paginate,
      },
      resolved: {
        operation: {
          target: operation === undefined ? undefined : resolveTarget(operation),
        },
      },
    }),
  );
}

describe("--paginate", () => {
  it("is allowed when it is not given", async () => {
    await expect(paging("getProject", false)).resolves.toEqual({ paginate: false });
  });

  it("is allowed while the operation is still to be chosen", async () => {
    await expect(paging(undefined, true)).resolves.toEqual({ paginate: true });
  });

  it("is allowed for an operation that has a cursor to follow", async () => {
    await expect(paging("queryUsers", true)).resolves.toEqual({ paginate: true });
  });

  it("is refused for an operation that does not page, naming it", async () => {
    await expect(paging("getProject", true)).resolves.toEqual({
      unmet: {
        operation: "getProject",
      },
    });
  });
});
