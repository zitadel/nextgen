import { Flags } from "@oclif/core";

import { refuseBlank } from "../../../lib/oclif/flags";
import { type Refusal, refusalError } from "../../../lib/oclif/refusal";
import { MESSAGE_MAX_LENGTH, messageTooLong } from "../../../lib/release";

const MESSAGE_TOO_LONG_REFUSAL: Refusal = {
  message: "the message is longer than {limit} characters",
  hint: "Pass a shorter summary with -m.",
  details: {
    argument: "--message",
  },
};

/**
 * What `-m/--message` records on a release or a deployment. It refuses a blank
 * message, which would record nothing, and one longer than the server records,
 * which the server would reject after the bundle was built. It returns the
 * message trimmed.
 */
function readMessage(input: string): string {
  const value = refuseBlank(input, "--message", "the value is empty");
  if (messageTooLong(value)) {
    throw refusalError(MESSAGE_TOO_LONG_REFUSAL, {
      limit: MESSAGE_MAX_LENGTH,
    });
  }
  return value;
}

/** `-m/--message`, validated by {@link readMessage}. */
export function messageFlag(description: string) {
  return Flags.custom<string>({
    char: "m",
    description,
    parse: async (input) => {
      return readMessage(input);
    },
  })();
}
