import { AbstractCLIScaffolder } from "./cli";

/**
 * Scaffolds a new Angular app with the Angular CLI. Unlike the SPA entry files
 * the patcher overwrites (`app.ts`/`app.html`), `ng new` produces those itself,
 * so no boilerplate cleanup is needed. Requires a Node version Angular supports
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
  }
}
