import { rm } from "node:fs/promises";
import { join } from "node:path";

import { AbstractCLIScaffolder } from "./cli";

/**
 * Scaffolds a new Qwik City app with `create-qwik` (the `empty` starter), then
 * removes the starter `src/routes/index.tsx` so the patcher can write the
 * managed landing page without colliding with boilerplate. `vite.config.ts` is
 * left in place — the Qwik City integration wires auth through the
 * `src/routes/plugin@nextgen.ts` `onRequest` plugin (a plain route file the
 * patcher writes), so no config edit is needed.
 */
export class QwikCityScaffolder extends AbstractCLIScaffolder {
  readonly displayName = "Qwik City";
  readonly supportedFrameworks: ReadonlyArray<string> = ["qwik-city"];

  async scaffold(cwd: string, _framework: string): Promise<void> {
    this.runCommand("npx", ["-y", "create-qwik@latest", "empty", "."], cwd);
    await rm(join(cwd, "src/routes/index.tsx"), { force: true });
  }
}
