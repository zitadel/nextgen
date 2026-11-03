import { Args, Flags } from "@oclif/core";

import { ZitadelError } from "../errors";
import { parseServer } from "../server";
import { interpolate, type Refusal, refusalError } from "./refusal";

/**
 * Refuse a value that is present but holds nothing.
 *
 * `required: true` is no help: it asks whether a token arrived in argv, and an
 * empty one satisfies it. The way this happens is the shell, not a typo —
 * `--client-id "$CLIENT_ID"` with the variable unset sends exactly that, the
 * expansion dropping the value while the quotes keep the word, so argv carries
 * `["--client-id", ""]`. Unquoted, the word vanishes and oclif refuses with
 * "expects a value"; quoted, nothing complained and the empty string travelled
 * on as if it were a real answer.
 *
 * Refusing during parse rather than in each command puts it at the same point
 * oclif's own refusal lands, so both spellings of a missing value fail the same
 * way, and the value that reaches the command is already trimmed. The refusal
 * names what was empty itself: `BaseCommand` puts back the message a flag's
 * `parse` raised, so a refusal reads the same wherever it came from.
 */
export function refuseBlank(input: string, label: string, message: string): string {
  const value = input.trim();
  if (value === "") {
    throw new ZitadelError("E_VALIDATION", message, {
      hint: `Pass a value for ${label}, or omit it entirely.`,
      details: { argument: label },
    });
  }
  return value;
}

/**
 * A string flag whose value must not be blank. See {@link refuseBlank}.
 *
 * Not for a flag that writes a field value: an empty string is a legitimate
 * thing to store, so the generated resource flags in `crud/fields.ts` keep
 * plain `Flags.string`.
 */
export const nonBlankString = Flags.custom<string>({
  parse: async (input, _command, flag) => {
    return refuseBlank(input, `--${flag.name}`, `--${flag.name} was given an empty value`);
  },
});

/** A positional argument whose value must not be blank. See {@link refuseBlank}. */
export const nonBlankArg = Args.custom<string>({
  parse: async (input, _command, arg) => {
    return refuseBlank(input, arg.name, `${arg.name} was given an empty value`);
  },
});

/** The whole numbers an integer flag accepts, and how it refuses the rest. */
export type IntegerRules = Readonly<{
  min?: number;
  max?: number;
  refusal?: Refusal;
}>;

function integerHint(rules: IntegerRules): string {
  if (rules.min !== undefined && rules.max !== undefined) {
    return "Use a whole number from {min} to {max}.";
  }
  if (rules.min !== undefined) {
    return "Use a whole number of {min} or more.";
  }
  if (rules.max !== undefined) {
    return "Use a whole number of {max} or less.";
  }
  return "Use a whole number.";
}

function parseInteger(input: string, flag: IntegerRules & { name: string }): number {
  const value = Number(input);
  // A run of digits says nothing about what `Number` made of it: enough of
  // them overflow to `Infinity`, and past 2^53 they round to a neighbour, so
  // the number itself is what must be whole and exact.
  const inside =
    Number.isSafeInteger(value) &&
    (flag.min === undefined || value >= flag.min) &&
    (flag.max === undefined || value <= flag.max);
  if (inside) {
    return value;
  }
  const refusal = flag.refusal ?? {
    message: "{value} is not a valid {flag}",
    hint: integerHint(flag),
  };
  const values = {
    value: input,
    flag: `--${flag.name}`,
    ...(flag.min === undefined ? {} : { min: flag.min }),
    ...(flag.max === undefined ? {} : { max: flag.max }),
  };
  throw new ZitadelError("E_VALIDATION", interpolate(refusal.message, values), {
    hint: refusal.hint === undefined ? undefined : interpolate(refusal.hint, values),
    details: {
      argument: values.flag,
    },
  });
}

/**
 * An integer flag that refuses what is not a whole number within `min` and
 * `max`, with `refusal` or the default wording. The refusal's placeholders are
 * `{value}` as typed, `{flag}`, `{min}` and `{max}`.
 */
export const integerFlag = Flags.custom<number, IntegerRules>({
  parse: async (input, _command, flag) => parseInteger(input, flag),
});

/**
 * The flag that names the server a command is about: `local`, or an http(s)
 * URL. It keeps what was typed, since a suggested retry repeats it.
 */
export const serverFlag = Flags.custom<string>({
  parse: async (input) => {
    if (input === "local") {
      return input;
    }
    const parsed = parseServer(input);
    if (!parsed.ok) {
      throw refusalError(
        {
          message: "{problem}",
          hint: "Use `local`, or a URL like https://acme.zitadel.cloud.",
        },
        {
          problem: parsed.problem,
        },
      );
    }
    return input;
  },
});
