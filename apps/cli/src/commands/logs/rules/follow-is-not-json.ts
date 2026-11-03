import { excludes, type Rule } from "../../../lib/oclif/rules";

/**
 * Refuses `--follow` beside `--json`: following writes lines as the server
 * writes them, which is a stream and never the one envelope `--json` promises.
 */
export const followIsNotJsonRule: Rule = excludes("follow", "json", {
  message: "Cannot stream logs with --json",
  hint: "Run without --json, or omit --follow.",
});
