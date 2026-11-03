import { Flags } from "@oclif/core";
import type { Parsed } from "@zitadel/config/idp";
import { z } from "zod";

import { type Refused, reads, whole } from "../../lib/oclif/flags";

const MIN_PORT = 1;
const MAX_PORT = 65_535;

/**
 * A TCP port, refusing what is not a whole number from 1 to 65535, which is no
 * port a server can listen on.
 */
const PORT: Refused<number> = {
  schema: whole.pipe(z.number().min(MIN_PORT).max(MAX_PORT)),
  refusal: {
    message: "{value} is not a TCP port",
    hint: "Use a TCP port from {min} to {max}.",
  },
  values: {
    min: MIN_PORT,
    max: MAX_PORT,
  },
};

/** A flag that holds a TCP port. Shared by `start`, `setup` and `doctor`. */
export const portFlag = Flags.custom<number>({
  parse: reads(PORT),
});

/**
 * The port a value names, for a prompt's `parse`, so a port typed at a prompt
 * and one passed as a flag are held to the same rule. See {@link portFlag}.
 */
export function readPort(value: string): Parsed<number> {
  const parsed = PORT.schema.safeParse(value);
  return parsed.success
    ? {
        ok: true,
        value: parsed.data,
      }
    : {
        ok: false,
        problem: "Must be a port number",
      };
}
