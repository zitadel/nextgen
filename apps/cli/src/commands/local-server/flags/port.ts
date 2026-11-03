import { Flags } from "@oclif/core";

import { type Refusal, refusalError } from "../../../lib/oclif/refusal";

const MIN_PORT = 1;
const MAX_PORT = 65_535;

export const PORT_REFUSAL: Refusal = {
  message: "{value} is not a TCP port",
  hint: "Use a TCP port from {min} to {max}.",
};

/**
 * Reads a TCP port, refusing what is not a whole number from 1 to 65535, which
 * is no port a server can listen on.
 */
export function readPort(input: string): number {
  const value = Number(input);
  if (/^-?\d+$/.test(input.trim()) && value >= MIN_PORT && value <= MAX_PORT) {
    return value;
  }
  throw refusalError(PORT_REFUSAL, {
    value: input,
    min: MIN_PORT,
    max: MAX_PORT,
  });
}

/** A flag that holds a TCP port. */
export const portFlag = Flags.custom<number>({
  parse: async (input) => {
    return readPort(input);
  },
});
