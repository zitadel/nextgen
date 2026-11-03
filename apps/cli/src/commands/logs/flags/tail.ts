import { Flags } from "@oclif/core";

import { type Refusal, refusalError } from "../../../lib/oclif/refusal";

/** How many lines `--tail` shows when it is not given. */
export const DEFAULT_TAIL = 200;

/** How `--tail` refuses a count that is not a number of lines. */
export const TAIL_REFUSAL: Refusal = {
  message: "{value} is not a valid tail",
  hint: "Use a positive integer.",
};

/**
 * Reads how many lines to show, refusing anything that is not a whole number
 * of one or more: a server writes whole lines, so a fraction names none of
 * them, and zero lines is a run that would print nothing.
 */
export function readTail(input: string): number {
  const value = Number(input);
  if (/^\d+$/.test(input.trim()) && value >= 1) {
    return value;
  }
  throw refusalError(TAIL_REFUSAL, {
    value: input,
  });
}

/** A flag that holds how many lines to show. See {@link readTail}. */
export const tailFlag = Flags.custom<number>({
  parse: async (input) => {
    return readTail(input);
  },
});
