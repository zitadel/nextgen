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

/**
 * Reads what a directory records about the server started in it, once per run.
 *
 * A command that reports which server it was about needs that before the run's
 * context is built, so its first event names the right server, and again while
 * it works. Reading it twice would ask the filesystem twice for the same
 * answer, so each directory's first read is kept — keyed by directory, since
 * one asked about is not evidence about another.
 */
export function startedServer<T>(read: (cwd: string) => Promise<T | undefined>) {
  const found = new Map<string, Promise<T | undefined>>();
  return {
    of: (cwd: string): Promise<T | undefined> => {
      const already = found.get(cwd);
      if (already !== undefined) {
        return already;
      }
      // Only an answer is worth keeping: a read that failed may have failed on
      // a half-written file or a busy machine, and the next caller deserves
      // its own attempt rather than this one's failure.
      const reading = read(cwd).catch((error: unknown) => {
        found.delete(cwd);
        throw error;
      });
      found.set(cwd, reading);
      return reading;
    },
  };
}
