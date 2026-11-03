import { Flags } from "@oclif/core";

import { type PasswordMinLength, parsePasswordMinLength } from "../../../lib/policies";
import { refuseBlank } from "../../../lib/oclif/flags";
import { type Refusal, refusalError } from "../../../lib/oclif/refusal";

const REFUSAL: Refusal = {
  message: "{problem}",
  hint: "Pass a whole number for {flag}, or 0 for none.",
  details: {
    argument: "{flag}",
  },
};

/**
 * A password minimum length flag, read with the prompt's parser so the two
 * cannot disagree: a whole number the policy accepts, or `null` for none.
 */
export const passwordMinLengthFlag = Flags.custom<PasswordMinLength>({
  parse: async (input, _command, flag) => {
    const parsed = parsePasswordMinLength(
      refuseBlank(input, `--${flag.name}`, `--${flag.name} was given an empty value`),
    );
    if (parsed.ok) {
      return parsed.value;
    }
    throw refusalError(REFUSAL, {
      problem: parsed.problem,
      flag: `--${flag.name}`,
    });
  },
});
