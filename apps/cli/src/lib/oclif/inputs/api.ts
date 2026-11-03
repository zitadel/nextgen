import { Flags } from "@oclif/core";

import { ZitadelError } from "../../errors";
import { interpolate, type Refusal } from "../refusal";

/** The HTTP methods `zitadel api` sends. */
export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

const METHOD_REFUSAL: Refusal = {
  message: "-X {value} is not one of {methods}",
};

/**
 * The HTTP method, in any case as curl takes it: oclif's `options` would
 * refuse `-X delete`. The value that arrives is upper case.
 */
export const httpMethodFlag = Flags.custom<string>({
  helpValue: HTTP_METHODS.join("|"),
  parse: async (input) => {
    const method = input.toUpperCase();
    if (!(HTTP_METHODS as readonly string[]).includes(method)) {
      throw new ZitadelError(
        "E_VALIDATION",
        interpolate(METHOD_REFUSAL.message, {
          value: input,
          methods: HTTP_METHODS.join(", "),
        }),
      );
    }
    return method;
  },
});
