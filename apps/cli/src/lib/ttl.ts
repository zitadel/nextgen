/** Seconds per unit a TTL string accepts. */
const MINUTE = 60;
const HOUR = 60 * 60;
const DAY = 24 * 60 * 60;

/**
 * What {@link Ttl.parse} throws for a string that is not a TTL. It belongs to no product: the
 * caller turns it into whatever error its own layer reports.
 */
export class TtlError extends Error {
  /** What to write instead, as a sentence the caller may show. */
  readonly hint: string;

  /**
   * @param message - What was wrong with the input.
   * @param hint - What to write instead.
   */
  constructor(message: string, hint: string) {
    super(message);
    this.name = new.target.name;
    this.hint = hint;
  }
}

/**
 * A duration written as a TTL: a positive whole number followed by a single `s`, `m`, `h` or `d`
 * unit, such as `7d`, `12h`, `90m` or `3600s`. It carries the canonical single-unit string, the
 * ISO-8601 duration the wire takes, and the duration in milliseconds.
 */
export class Ttl {
  /** The canonical single-unit string: minutes, hours or days, never seconds. */
  readonly canonical: string;

  /** The ISO-8601 duration the API takes (`P7D`, `PT1H`, `PT90M`). */
  readonly iso: string;

  /** The duration in milliseconds. */
  readonly ms: number;

  /**
   * @param seconds - The duration, in whole seconds.
   */
  private constructor(seconds: number) {
    this.canonical = Ttl.format(seconds);
    this.iso = Ttl.isoDuration(seconds);
    this.ms = seconds * 1000;
  }

  /**
   * Parses a TTL like `7d`, `12h`, `90m` or `3600s`. Seconds are accepted as input, but the
   * canonical form is minutes, hours or days only (see {@link Ttl.format}), so a value given in
   * seconds is re-expressed. Range limits are the caller's to apply.
   *
   * @param input - The TTL as a person wrote it.
   * @returns The parsed TTL.
   * @throws {TtlError} When the input is not a whole number followed by `s`, `m`, `h` or `d`.
   */
  static parse(input: string): Ttl {
    const match = /^([1-9][0-9]*)(s|m|h|d)$/.exec(input.trim());
    if (!match) {
      throw new TtlError(
        `${input} is not a valid ttl`,
        "Use a whole number followed by s, m, h or d, e.g. 7d, 12h or 90m.",
      );
    }
    const unit = match[2] === "s" ? 1 : match[2] === "m" ? MINUTE : match[2] === "h" ? HOUR : DAY;
    return new Ttl(Number(match[1]) * unit);
  }

  /**
   * The ISO-8601 duration for a whole number of seconds, the form the API takes (`P7D`, `PT1H`,
   * `PT90M`). The flag keeps the shorter `7d`/`12h` spelling because that is what a person writes;
   * only the wire sees this one. A whole number of days is a date-part duration (`P7D`); anything
   * else is a time-part one carrying the coarsest exact unit. It rounds a sub-minute remainder up
   * to the next whole minute exactly as {@link Ttl.format} does, so what the caller is shown and
   * what the wire carries are the same duration.
   *
   * @param seconds - The duration, in whole seconds.
   * @returns The ISO-8601 duration.
   */
  static isoDuration(seconds: number): string {
    if (seconds % DAY === 0) {
      return `P${seconds / DAY}D`;
    }
    if (seconds % HOUR === 0) {
      return `PT${seconds / HOUR}H`;
    }
    return `PT${Math.ceil(seconds / MINUTE)}M`;
  }

  /**
   * The canonical TTL string for a whole number of seconds: the coarsest of day, hour or minute
   * that divides it exactly, else rounded up to the next whole minute (the finest unit the
   * canonical form uses).
   *
   * @param seconds - The duration, in whole seconds.
   * @returns The canonical string, such as `7d`, `12h` or `90m`.
   */
  static format(seconds: number): string {
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
}
