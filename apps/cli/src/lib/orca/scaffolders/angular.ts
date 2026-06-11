import { rm } from "node:fs/promises";
import { basename, join } from "node:path";

import { AbstractCLIScaffolder } from "./cli";

/**
 * Derives a valid Angular project name from the target directory. `ng new`
 * validates the name against `^[a-zA-Z0-9-~][a-zA-Z0-9-._~]*$` and rejects `.`,
 * so we slugify the directory's basename (lowercase, non-alphanumerics → `-`)
 * and guarantee a leading letter, falling back to `app` for an unusable name.
 */
function angularProjectName(cwd: string): string {
  const slug = basename(cwd)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return /^[a-z]/.test(slug) ? slug : `app-${slug || "zitadel"}`;
}

/**
 * Scaffolds a new Angular app with the Angular CLI, then removes the starter
 * `app.ts`/`app.html` root component (and its now-unreferenced `app.css`) so the
 * patcher can write the managed ones without colliding with boilerplate. The
 * managed component uses only `templateUrl`, so `app.css` would otherwise be a
 * dangling file eject never cleans up. Unlike `create-vite`/`nuxi`, `ng new`
 * needs a real project name plus `--directory .` to populate the current dir.
 * Requires a Node version Angular supports (^22.22.3 || ^24.15.0 || >=26).
 */
export class AngularScaffolder extends AbstractCLIScaffolder {
  readonly displayName = "Angular";
  readonly supportedFrameworks: ReadonlyArray<string> = ["angular"];

  async scaffold(cwd: string, _framework: string): Promise<void> {
    this.runCommand(
      "npx",
      [
        "-y",
        "@angular/cli@latest",
        "new",
        angularProjectName(cwd),
        "--directory",
        ".",
        "--defaults",
        "--style=css",
        "--ssr=false",
        "--skip-git",
      ],
      cwd,
    );
    await rm(join(cwd, "src/app/app.ts"), { force: true });
    await rm(join(cwd, "src/app/app.html"), { force: true });
    await rm(join(cwd, "src/app/app.css"), { force: true });
  }
}
