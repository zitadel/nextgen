import { resolveTarget, type Target, uncallable } from "../../../lib/api/operations";
import type { Refusal } from "../../../lib/oclif/refusal";
import { requirement, unmet } from "../../../lib/oclif/requirements";

const UNCALLABLE_REFUSAL: Refusal = {
  message: "{reason}",
  hint: "Call it from the app it belongs to, through the SDK; `zitadel api ls` marks what the CLI can call.",
};

/** The operation the command line names, or none when it is left to be chosen from a list. */
export type Chosen = Readonly<{
  target: Target | undefined;
}>;

/**
 * The operation `zitadel api` is pointed at: an operation id or a path, with
 * `-X` choosing among a path's methods. It refuses one the spec does not have
 * and one the CLI cannot call, because only an end user's session cookie
 * authenticates it. With no operation named, a person is asked to choose one.
 */
function chosenOperation(
  ref: string | undefined,
  method: string | undefined,
): Chosen | { reason: string } {
  if (ref === undefined) {
    return {
      target: undefined,
    };
  }
  const target = resolveTarget(ref, method);
  const reason = uncallable(target.operation);
  return reason === undefined
    ? {
        target,
      }
    : {
        reason,
      };
}

export const apiOperation = requirement<Chosen>({
  refusal: UNCALLABLE_REFUSAL,
  resolve: async ({ args, flags }) => {
    const chosen = chosenOperation(
      args.operation as string | undefined,
      flags.method as string | undefined,
    );
    return "reason" in chosen ? unmet(chosen) : chosen;
  },
});
