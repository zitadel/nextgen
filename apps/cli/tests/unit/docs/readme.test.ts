import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { Config } from "@oclif/core";
import { describe, expect, it } from "vitest";

import { cliPackageRoot } from "@tests/helpers/oclif-build";

/** The built CLI's command list, as a run reads it. */
const config = await Config.load(cliPackageRoot);

/**
 * The id of the command a heading of the README's reference names: the words
 * after the binary, up to the first argument, which oclif prints in capitals
 * or in brackets (`policy test [OPERATION]` is `policy:test`).
 */
function idOf(usage: string): string {
  const words = usage.split(" ");
  const argument = words.findIndex((word) => {
    return !/^[a-z][a-z0-9-]*$/.test(word);
  });
  return (argument === -1 ? words : words.slice(0, argument)).join(":");
}

describe("README.md", () => {
  // npm shows the README, so a command renamed or removed without it leaves
  // the package's front page naming one that does not run.
  it("documents exactly the commands the CLI lists; regenerate it with `turbo run readme --filter=@zitadel/cli`", async () => {
    const readme = await readFile(join(cliPackageRoot, "README.md"), "utf8");
    const reference = readme.slice(
      readme.indexOf("<!-- commands -->"),
      readme.indexOf("<!-- commandsstop -->"),
    );
    const documented = [...reference.matchAll(/^## `zitadel ([^`]+)`$/gm)].map(([, usage = ""]) => {
      return idOf(usage);
    });

    const listed = config.commands
      .filter((command) => {
        return command.hidden !== true;
      })
      .map((command) => {
        return command.id;
      });

    expect([...documented].sort()).toEqual([...listed].sort());
  });
});
