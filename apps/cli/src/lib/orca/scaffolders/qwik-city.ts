import { rm } from "node:fs/promises";
import { join } from "node:path";

import { AbstractCLIScaffolder } from "./cli";
import type { NodeEngines } from "./node-engines";
import { removeInstall } from "./remove-install";

/**
 * The `create-qwik` release that scaffolds a Qwik 2 app (`@qwik.dev/core` +
 * `@qwik.dev/router` on Vite 8). Pinned exactly: `create-qwik@latest` still
 * scaffolds Qwik 1 (`@builder.io/qwik-city`), whose `vite <8` peer conflicts
 * with the Qwik 2 `@zitadel/sdk-qwik` widgets the pages render, and the moving
 * `rc` dist-tag would follow a future major's release candidate. The generated
 * app declares `^` ranges, so it still picks up Qwik 2 patch releases.
 */
const CREATE_QWIK = "create-qwik@2.0.0-rc.3";

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

  readonly nodeEngines: NodeEngines = {
    label: "create-qwik",
    spec: CREATE_QWIK,
    fallback: "^18.17.0 || ^20.3.0 || >=21.0.0",
    enforcement: "warn",
  };
  override readonly pinnedPackages: ReadonlyArray<string> = [CREATE_QWIK];

  protected async create(cwd: string, _framework: string): Promise<void> {
    this.runCommand("npx", ["-y", CREATE_QWIK, "empty", ".", "--installDeps=false"], cwd);
    await rm(join(cwd, "src/routes/index.tsx"), { force: true });
    // Setup must install the workspace packages from the detected registry with
    // npm (no lockfile). `--installDeps=false` already skips create-qwik's own
    // install; removing any install it leaves keeps that true if a future
    // release flips the default.
    await removeInstall(cwd);
  }
}
