import type { Hook } from "@oclif/core";

/**
 * Makes `--version --json` answer as every command does. oclif prints the
 * version line itself after this hook, so the hook runs the wrapped `version`
 * command and blanks the line oclif is about to print: what follows the
 * envelope is whitespace a reader ignores.
 */
const hook: Hook<"init"> = async ({ id, argv, config }) => {
  if (id === "--version" && argv.includes("--json")) {
    await config.runCommand("version", ["--json"]);
    Reflect.set(config, "userAgent", "");
  }
};

export default hook;
