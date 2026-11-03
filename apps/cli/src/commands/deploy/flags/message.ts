import { Flags } from "@oclif/core";

import { refuseBlank } from "../../../lib/oclif/flags";
import { type Refusal, refusalError } from "../../../lib/oclif/refusal";

const MESSAGE_MAX_LENGTH = 1024;

const MESSAGE_REFUSAL: Refusal = {
  message: "the message is longer than {limit} characters",
  hint: "Pass a shorter summary with -m.",
  details: {
    argument: "--message",
  },
};

/** Reads `-m/--message`, refusing a blank one or one longer than the server records. */
function readMessage(input: string): string {
  const value = refuseBlank(input, "--message", "the value is empty");
  if (Array.from(value).length > MESSAGE_MAX_LENGTH) {
    throw refusalError(MESSAGE_REFUSAL, {
      limit: MESSAGE_MAX_LENGTH,
    });
  }
  return value;
}

/** What a deploy records as the reason for a release. */
export const messageFlag = Flags.custom<string>({
  char: "m",
  parse: async (input) => {
    return readMessage(input);
  },
});
