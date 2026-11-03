import type { ApiRequest } from "../../../lib/api/request";
import type { Refusal } from "../../../lib/oclif/refusal";
import { requirement, unmet } from "../../../lib/oclif/requirements";
import type { Payload } from "./payload";

export const FORCE_REQUIRED_REFUSAL: Refusal = {
  message: "Cannot call {operation} without --force in non-interactive mode",
  hint: "Run the same command again, with its --field values or the pipe into --input, and add --force.",
};

/**
 * Whether a call needs `--force` and nobody can be asked. An operation that
 * deletes, revokes or rolls back asks first; with a body it cannot name a retry,
 * since a body can hold a secret or have come from a pipe a rerun of the command
 * alone would not have, so the refusal cannot suggest one and says what to do.
 * A dry run calls nothing, so it asks nothing.
 */
export function needsForce(
  request: ApiRequest | undefined,
  run: { dryRun: boolean; nonInteractive: boolean; force: boolean },
): boolean {
  return (
    request !== undefined &&
    request.operation.destructive &&
    request.body !== undefined &&
    run.nonInteractive &&
    !run.force &&
    !run.dryRun
  );
}

export const apiForce = requirement<{ forced: boolean }>({
  refusal: FORCE_REQUIRED_REFUSAL,
  resolve: async ({ meta, resolved }) => {
    const { request } = resolved.payload as Payload;
    return needsForce(request, meta)
      ? unmet({
          operation: request?.operation.id,
        })
      : {
          forced: meta.force,
        };
  },
});
