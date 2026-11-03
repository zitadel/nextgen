import { Args } from "@oclif/core";

import { classifyTarget } from "../../pull-target";
import { interpolate } from "../refusal";
import { ZitadelError } from "../../errors";

const REFUSAL = {
  message: 'Don\'t know how to pull "{value}".',
  hint: "Pass 'latest', a release id (rel_…), or a deployment id (dep_…).",
};

/**
 * What `pull` is asked to pull: `latest`, a release id (`rel_…`) or a
 * deployment id (`dep_…`). Anything else is refused before the command runs.
 */
export const pullTargetArg = Args.custom<string>({
  parse: async (input) => {
    if (classifyTarget(input).kind === "invalid") {
      throw new ZitadelError("E_VALIDATION", interpolate(REFUSAL.message, { value: input }), {
        hint: REFUSAL.hint,
      });
    }
    return input;
  },
});
