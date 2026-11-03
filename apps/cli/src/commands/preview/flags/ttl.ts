import { Flags } from "@oclif/core";

import { type Refusal, refusalError } from "../../../lib/oclif/refusal";
import { parseTtl, type Ttl } from "../../../lib/ttl";

const TTL_OUT_OF_RANGE_REFUSAL: Refusal = {
  message: "{value} is outside the allowed range",
  hint: "A preview lives between 60s and 365d.",
};

const MINIMUM_MS = 60 * 1000;
const MAXIMUM_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * How long a preview stays live, as `7d`, `12h` or `90m`. It refuses a value
 * that is not a duration and one outside the server's fixed limits of a minute
 * and 365 days.
 */
function readTtl(input: string): Ttl {
  const ttl = parseTtl(input);
  if (ttl.ms < MINIMUM_MS || ttl.ms > MAXIMUM_MS) {
    throw refusalError(TTL_OUT_OF_RANGE_REFUSAL, {
      value: input,
    });
  }
  return ttl;
}

/** `--ttl`, validated by {@link readTtl}. */
export const ttlFlag = Flags.custom<Ttl>({
  parse: async (input) => readTtl(input),
});
