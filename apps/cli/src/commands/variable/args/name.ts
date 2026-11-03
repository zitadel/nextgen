import { Args } from "@oclif/core";

import { refuseBlank } from "../../../lib/oclif/flags";
import { type Refusal, refusalError } from "../../../lib/oclif/refusal";
import { VARIABLE_NAME_MAX, variableNameProblem } from "../../../lib/variables";

/** What a name holding anything but letters, digits and underscores is refused for. */
export const VARIABLE_NAME_INVALID_REFUSAL: Refusal = {
  message: 'Invalid variable name "{value}".',
  hint: "A variable name contains only letters, digits and underscores.",
};

/** What a name the platform would refuse for its length is refused for. */
export const VARIABLE_NAME_TOO_LONG_REFUSAL: Refusal = {
  message: "Variable name is {length} characters; the limit is {max}.",
  hint: "Shorten the name.",
};

/**
 * The variable name `input` holds, trimmed as the one a prompt would have
 * accepted. Refuses a blank value, naming `label`, and one the platform would
 * refuse.
 */
export function readVariableName(input: string, label = "name"): string {
  const value = refuseBlank(input, label, `${label} was given an empty value`);
  const problem = variableNameProblem(value);
  if (problem === undefined) {
    return value;
  }
  throw refusalError(
    problem === "too-long" ? VARIABLE_NAME_TOO_LONG_REFUSAL : VARIABLE_NAME_INVALID_REFUSAL,
    {
      value,
      length: value.length,
      max: VARIABLE_NAME_MAX,
    },
  );
}

/** A positional argument that names a variable, refused before the command runs by {@link readVariableName}. */
export const variableNameArg = Args.custom<string>({
  parse: async (input, _command, arg) => {
    return readVariableName(input, arg.name);
  },
});
