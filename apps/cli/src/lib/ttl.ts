import { ZitadelError } from "./errors";

/** Seconds per unit a TTL string accepts. */
const MINUTE = 60;
const HOUR = 60 * 60;
const DAY = 24 * 60 * 60;

/** A TTL parsed into its canonical single-unit string and its duration in milliseconds. */
export type Ttl = Readonly<{ canonical: string; ms: number }>;

/**
 * Parse a TTL like `7d`, `12h`, `90m` or `3600s` — a positive whole number
 * followed by a single `s`/`m`/`h`/`d` unit — into its canonical single-unit
 * string and its duration in milliseconds. Seconds are accepted as input, but
 * the canonical form is minutes, hours or days only (see {@link formatTtl}), so
 * a value given in seconds is re-expressed. A malformed input is an
 * `E_VALIDATION`. Range limits are the caller's to apply.
 */
export function parseTtl(input: string): Ttl {
  const match = /^([1-9][0-9]*)(s|m|h|d)$/.exec(input.trim());
  if (!match) {
    throw new ZitadelError("E_VALIDATION", `${input} is not a valid ttl`, {
      hint: "Use a whole number followed by s, m, h or d, e.g. 7d, 12h or 90m.",
    });
  }
  const unit = match[2] === "s" ? 1 : match[2] === "m" ? MINUTE : match[2] === "h" ? HOUR : DAY;
  const seconds = Number(match[1]) * unit;
  return { canonical: formatTtl(seconds), ms: seconds * 1000 };
}

/**
 * The canonical TTL string for a whole number of seconds: the coarsest of day,
 * hour or minute that divides it exactly, else rounded up to the next whole
 * minute (the finest unit the canonical form uses).
 */
export function formatTtl(seconds: number): string {
  if (seconds % DAY === 0) {
    return `${seconds / DAY}d`;
  }
  if (seconds % HOUR === 0) {
    return `${seconds / HOUR}h`;
  }
  if (seconds % MINUTE === 0) {
    return `${seconds / MINUTE}m`;
  }
  return `${Math.ceil(seconds / MINUTE)}m`;
}
