import { excludes } from "../../../../lib/oclif/rules";

/** Refuses a secret given as an argument, because it would land in shell history. */
export const secretValueRule = excludes("secret", "value", {
  message: "A secret value is not given on the command line.",
  hint: "Drop the value and pipe it in, or let the prompt ask for it.",
});
