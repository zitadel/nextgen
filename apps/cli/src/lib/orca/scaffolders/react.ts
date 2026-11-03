import { rm } from "node:fs/promises";
import { join } from "node:path";

import { AbstractCLIScaffolder } from "./cli";
import { CREATE_VITE_NODE_ENGINES, CREATE_VITE_VERSION } from "./node-engines";

/**
 * Scaffolds a new Vite + React (TypeScript) single-page app with `create-vite`,
 * then removes the starter `App.tsx`/`App.css` demo so the patcher can write the
 * managed `src/App.tsx` without colliding with boilerplate. `index.css` and
 * `main.tsx` are left in place — the patched `App.tsx` keeps the same entry.
 */
export class ReactScaffolder extends AbstractCLIScaffolder {
  readonly displayName = "React (Vite)";
  readonly supportedFrameworks: ReadonlyArray<string> = ["react"];
  readonly nodeEngines = CREATE_VITE_NODE_ENGINES;
  override readonly pinnedPackages: ReadonlyArray<string> = [CREATE_VITE_NODE_ENGINES.spec];

  protected async create(cwd: string, _framework: string): Promise<void> {
    this.runCommand(
      "npm",
      ["create", `vite@${CREATE_VITE_VERSION}`, ".", "--", "--template", "react-ts"],
      cwd,
    );
    await rm(join(cwd, "src/App.tsx"), { force: true });
    await rm(join(cwd, "src/App.css"), { force: true });
  }
}
