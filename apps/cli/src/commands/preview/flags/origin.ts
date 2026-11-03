import { Flags } from "@oclif/core";

import { refuseBlank } from "../../../lib/oclif/flags";
import { type Refusal, refusalError } from "../../../lib/oclif/refusal";

export const ORIGIN_IS_PRIMARY_REFUSAL: Refusal = {
  message: "A preview cannot target the primary origins",
  hint: "Pass the preview URLs with --origin; production is deployed by `zitadel deploy`, after merge.",
};

/**
 * A preview URL as `--origin` names it. An origin has no path, so a trailing
 * slash is dropped and one preview is one spelling. It refuses a blank value
 * and `primary`, the deployment keyword for every primary origin, which a
 * preview build must never reach with its narrower credential.
 */
export function readOrigin(input: string, label: string): string {
  const url = refuseBlank(input, label, "the value is empty").replace(/\/+$/, "");
  if (url === "primary") {
    throw refusalError(ORIGIN_IS_PRIMARY_REFUSAL, {});
  }
  return url;
}

/** `--origin`, validated by {@link readOrigin}. */
export const originFlag = Flags.custom<string>({
  parse: async (input, _command, flag) => readOrigin(input, `--${flag.name}`),
});
