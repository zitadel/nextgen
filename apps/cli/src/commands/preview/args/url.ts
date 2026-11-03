import { Args } from "@oclif/core";

import { refuseBlank } from "../../../lib/oclif/flags";

/**
 * A preview URL given as an argument. It refuses a blank value, and drops a
 * trailing slash that names the same origin but, sent as typed, would match
 * nothing.
 */
export function readUrl(input: string, label: string): string {
  return refuseBlank(input, label, `${label} was given an empty value`).replace(/\/+$/, "");
}

/** The preview URL argument, validated by {@link readUrl}. */
export const urlArg = Args.custom<string>({
  parse: async (input, _command, arg) => readUrl(input, arg.name),
});
