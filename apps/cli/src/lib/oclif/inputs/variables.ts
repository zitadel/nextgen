import { Args } from "@oclif/core";

import { ZitadelError } from "../../errors";
import { VARIABLE_NAME_MAX, variableNameProblem } from "../../variables";
import { interpolate, type Refusal } from "../refusal";

const REFUSALS: Readonly<Record<"invalid" | "too-long", Refusal>> = {
  invalid: {
    message: 'Invalid variable name "{value}".',
    hint: "A variable name contains only letters, digits and underscores.",
  },
  "too-long": {
    message: "Variable name is {length} characters; the limit is {max}.",
    hint: "Shorten the name.",
  },
};

/**
 * A positional argument that names a variable: refused, before the command
 * runs, when the platform would refuse the name. The refusals' placeholders
 * are `{value}`, `{length}` and `{max}`.
 */
export const variableNameArg = Args.custom<string>({
  parse: async (input) => {
    const problem = variableNameProblem(input);
    if (problem === undefined) {
      return input;
    }
    const refusal = REFUSALS[problem];
    const values = {
      value: input,
      length: input.length,
      max: VARIABLE_NAME_MAX,
    };
    throw new ZitadelError("E_VALIDATION", interpolate(refusal.message, values), {
      hint: refusal.hint === undefined ? undefined : interpolate(refusal.hint, values),
    });
  },
});
