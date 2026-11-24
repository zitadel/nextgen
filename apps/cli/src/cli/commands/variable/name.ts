import { Args } from "@oclif/core";

import { VariableService } from "@/lib/backend";
import { filled } from "@/cli/core/flags";
import { type Refusal, refusalError } from "@/cli/core/refusal";

/** What a name holding anything but letters, digits and underscores is refused for. */
const VARIABLE_NAME_INVALID_REFUSAL = {
  message: "Invalid variable name {value}.",
  hint: "A variable name contains only letters, digits and underscores.",
} as const satisfies Refusal;

/** What a name the platform would refuse for its length is refused for. */
const VARIABLE_NAME_TOO_LONG_REFUSAL = {
  message: "Variable name is {length} characters; the limit is {max}.",
  hint: "Shorten the name.",
} as const satisfies Refusal;

/** What a blank name is refused for, named after the argument that took it. */
const VARIABLE_NAME_EMPTY_REFUSAL = {
  message: "{input} was given an empty value",
  hint: "Pass a value for {input}, or omit it entirely.",
} as const satisfies Refusal;

/**
 * A positional argument that names a variable, refused before the command runs.
 * The value is trimmed as the one a prompt would have accepted. A blank value
 * is refused, naming the argument, and so is one the platform would refuse,
 * each with its own wording, which is why this reads the grammar itself rather
 * than declaring one {@link import("@/cli/core/flags").Refused}.
 *
 * What the platform accepts is {@link VariableService.nameProblem}'s to say, so
 * the grammar has one home and a name is refused here against the same rule the
 * write is checked against.
 *
 * A refused name is quoted but raw: the envelope carries it as it was typed,
 * and the terminal rendering spells out a newline or escape sequence in it.
 */
export const variableNameArg = Args.custom<string>({
  parse: async (input, _command, arg) => {
    const name = filled.safeParse(input);
    if (!name.success) {
      throw refusalError(VARIABLE_NAME_EMPTY_REFUSAL, {
        input: arg.name,
      });
    }
    const value = name.data;
    const problem = VariableService.nameProblem(value);
    if (problem === undefined) {
      return value;
    }
    throw refusalError(
      problem === "too-long" ? VARIABLE_NAME_TOO_LONG_REFUSAL : VARIABLE_NAME_INVALID_REFUSAL,
      {
        value: `"${value}"`,
        length: value.length,
        max: VariableService.nameMaxLength,
      },
    );
  },
});
