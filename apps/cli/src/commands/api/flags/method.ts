import { Flags } from "@oclif/core";

import { type Refusal, refusalError } from "../../../lib/oclif/refusal";

/** The HTTP methods `zitadel api` sends. */
export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

export const METHOD_NOT_SENT_REFUSAL: Refusal = {
  message: "-X {value} is not one of {methods}",
};

/**
 * The HTTP method `-X` names, in any case as curl takes it: oclif's `options`
 * would refuse `-X delete`. It refuses a method the CLI does not send, and
 * returns the others in upper case.
 */
export function readMethod(input: string): string {
  const method = input.toUpperCase();
  if (!(HTTP_METHODS as readonly string[]).includes(method)) {
    throw refusalError(METHOD_NOT_SENT_REFUSAL, {
      value: input,
      methods: HTTP_METHODS.join(", "),
    });
  }
  return method;
}

/** `-X/--method`, validated by {@link readMethod}. */
export const methodFlag = Flags.custom<string>({
  helpValue: HTTP_METHODS.join("|"),
  parse: async (input) => readMethod(input),
});
