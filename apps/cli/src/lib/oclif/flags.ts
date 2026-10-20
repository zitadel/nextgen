import { Args, Flags } from "@oclif/core";

import { ZitadelError } from "../errors";

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
 * way, and the value that reaches `run` is already trimmed.
 */
function refuseBlank(input: string, label: string, message: string): string {
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
  // oclif prefixes a flag's parse failure with "Parsing --<name>", so the
  // message must not name it again.
  parse: async (input, _command, flag) =>
    refuseBlank(input, `--${flag.name}`, "the value is empty"),
});

/** A positional argument whose value must not be blank. See {@link refuseBlank}. */
export const nonBlankArg = Args.custom<string>({
  // An argument's failure carries no such prefix, so this one names itself.
  parse: async (input, _command, arg) =>
    refuseBlank(input, arg.name, `${arg.name} was given an empty value`),
});
