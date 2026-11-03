import type { Target } from "../../../lib/api/operations";
import type { Refusal } from "../../../lib/oclif/refusal";
import { requirement, unmet } from "../../../lib/oclif/requirements";
import type { Chosen } from "./operation";

const NOTHING_TO_PAGE_REFUSAL: Refusal = {
  message: "{operation} does not page, so --paginate has nothing to follow",
  hint: "Leave out --paginate.",
};

/** Whether `--paginate` has a cursor to follow on the operation, when one is named. */
function pagesOperation(target: Target | undefined, paginate: boolean): boolean {
  return !paginate || target === undefined || target.operation.paging !== null;
}

export const apiPaging = requirement<{ paginate: boolean }>({
  refusal: NOTHING_TO_PAGE_REFUSAL,
  resolve: async ({ flags, resolved }) => {
    const { target } = resolved.operation as Chosen;
    const paginate = flags.paginate === true;
    return pagesOperation(target, paginate)
      ? {
          paginate,
        }
      : unmet({
          operation: target?.operation.id,
        });
  },
});
