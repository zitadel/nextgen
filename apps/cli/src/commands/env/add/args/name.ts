import { Args } from "@oclif/core";

import { isEnvironmentName } from "../../../../lib/environment";
import { type Refusal, refusalError } from "../../../../lib/oclif/refusal";

/** What an environment name is refused for: it must be usable in a `.env.<name>.local` file name. */
const ENVIRONMENT_NAME_REFUSAL: Refusal = {
  message: '"{value}" is not a usable environment name',
  hint: 'Use letters, digits, dot, dash and underscore, and no "..", e.g. production.',
};

/** The environment name `input` holds, or the refusal for why it cannot name a file. */
function readEnvironmentName(input: string): string {
  if (!isEnvironmentName(input)) {
    throw refusalError(ENVIRONMENT_NAME_REFUSAL, {
      value: input,
    });
  }
  return input;
}

/** A positional argument that names an environment, refused before the command runs by {@link readEnvironmentName}. */
export const environmentNameArg = Args.custom<string>({
  parse: async (input) => {
    return readEnvironmentName(input);
  },
});
