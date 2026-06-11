import { rm } from "node:fs/promises";
import { join } from "node:path";

import { AbstractCLIScaffolder } from "./cli";

/**
 * Scaffolds a new Angular app with the Angular CLI, then removes the starter
 * `app.ts`/`app.html` root component so the patcher can write the managed ones
 * without colliding with boilerplate. Requires a Node version Angular supports
 * (Angular 22 needs Node ^22.22.3 || ^24.15.0 || >=26).
 */
export class AngularScaffolder extends AbstractCLIScaffolder {
  readonly displayName = "Angular";
  readonly supportedFrameworks: ReadonlyArray<string> = ["angular"];

  async scaffold(cwd: string, _framework: string): Promise<void> {
    this.runCommand(
      "npx",
      ["-y", "@angular/cli@latest", "new", ".", "--defaults", "--style=css", "--ssr=false", "--skip-git"],
      cwd,
    );
    await rm(join(cwd, "src/app/app.ts"), { force: true });
    await rm(join(cwd, "src/app/app.html"), { force: true });
  }
}
