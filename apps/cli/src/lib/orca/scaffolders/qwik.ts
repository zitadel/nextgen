import { rm } from "node:fs/promises";
import { join } from "node:path";

import { AbstractCLIScaffolder } from "./cli";

/**
 * Scaffolds a new Vite + Qwik (TypeScript) single-page app with `create-vite`,
 * then removes the starter `app.tsx`/`app.css` demo so the patcher can write the
 * managed `src/app.tsx` without colliding with boilerplate. The create-vite Qwik
 * template uses a lowercase `app.tsx` (named `App` export, mounted by `main.tsx`)
 * — the patched file keeps that same entry.
 */
export class QwikScaffolder extends AbstractCLIScaffolder {
  readonly displayName = "Qwik (Vite)";
  readonly supportedFrameworks: ReadonlyArray<string> = ["qwik"];

  async scaffold(cwd: string, _framework: string): Promise<void> {
    this.runCommand("npm", ["create", "vite@latest", ".", "--", "--template", "qwik-ts"], cwd);
    await rm(join(cwd, "src/app.tsx"), { force: true });
    await rm(join(cwd, "src/app.css"), { force: true });
  }
}
