import { Flags } from "@oclif/core";

import { ZitadelError } from "../../errors";
import { type PasswordMinLength, parsePasswordMinLength } from "../../policies";
import { refuseBlank } from "../flags";
import { interpolate } from "../refusal";

const REFUSAL = {
  message: "{problem}",
  hint: "Pass a whole number for {flag}, or 0 for none.",
};

/**
 * A password minimum length flag, read with the prompt's parser so the two
 * cannot disagree: a whole number the policy accepts, or `null` for none.
 */
export const passwordMinLengthFlag = Flags.custom<PasswordMinLength>({
  parse: async (input, _command, flag) => {
    const parsed = parsePasswordMinLength(
      refuseBlank(input, `--${flag.name}`, "the value is empty"),
    );
    if (parsed.ok) {
      return parsed.value;
    }
    const values = {
      problem: parsed.problem,
      flag: `--${flag.name}`,
    };
    throw new ZitadelError("E_VALIDATION", interpolate(REFUSAL.message, values), {
      hint: interpolate(REFUSAL.hint, values),
      details: {
        argument: values.flag,
      },
    });
  },
});
