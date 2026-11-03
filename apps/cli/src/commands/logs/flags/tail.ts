import { Flags } from "@oclif/core";

import { type Refusal, refusalError } from "../../../lib/oclif/refusal";

/** How many lines `--tail` shows when it is not given. */
const DEFAULT_TAIL = 200;

/** How `--tail` refuses a count that is not a number of lines. */
const TAIL_REFUSAL: Refusal = {
  message: "{value} is not a valid tail",
  hint: "Use a positive integer.",
};

/**
 * Reads how many lines to show, refusing anything that is not a whole number
 * of one or more: a server writes whole lines, so a fraction names none of
 * them, and zero lines is a run that would print nothing.
 */
function readTail(input: string): number {
  // Digits alone are not enough, and nor is the number alone: `1e3` is not a
  // count a person typed, while enough digits overflow to `Infinity`, which
  // Docker is handed verbatim and the binary backend reads as the whole log.
  const value = Number(input);
  if (/^\d+$/.test(input.trim()) && Number.isSafeInteger(value) && value >= 1) {
    return value;
  }
  throw refusalError(TAIL_REFUSAL, {
    value: input,
  });
}

/**
 * A flag that holds how many lines to show, {@link DEFAULT_TAIL} of them when
 * it is not given.
 */
export const tailFlag = Flags.custom<number>({
  default: DEFAULT_TAIL,
  parse: async (input) => {
    return readTail(input);
  },
});
