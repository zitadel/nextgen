import { Config } from "@oclif/core";
import { describe, expect, it } from "vitest";

import { named } from "@/lib/oclif/names";
import { cliPackageRoot } from "@tests/helpers/oclif-build";

const config = await Config.load(cliPackageRoot);

/**
 * Two names a command declares must not read the same. The parsed flags are
 * keyed as code reads them, so `page-token` beside `pageToken` would leave one
 * of them unreachable and that flag would silently do nothing. It is a
 * declaration mistake, so it fails here rather than on the run.
 */
describe("the names every command declares", () => {
  it("never gives two of them the same reading", () => {
    const colliding: string[] = [];

    for (const command of config.commands) {
      // The manifest already carries what each command declares, so nothing
      // here loads a command module to read it.
      for (const bag of [command.flags, command.args]) {
        const read = new Map<string, string>();
        for (const declared of Object.keys(bag ?? {})) {
          const already = read.get(named(declared));
          if (already !== undefined) {
            colliding.push(
              `${command.id}: ${already} and ${declared} are both read as ${named(declared)}`,
            );
          }
          read.set(named(declared), declared);
        }
      }
    }

    expect(colliding).toEqual([]);
  });
});
