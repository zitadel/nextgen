import type { StepOutput } from "./publish";
import { reportWarning } from "./warnings";

/** Where a publish says things to the person: warnings through the CLI's channel, text on stdout. */
export const stepOutput: StepOutput = {
  warn: reportWarning,
  say: (text) => {
    process.stdout.write(text);
  },
};
