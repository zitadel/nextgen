import { assertDependencyFloor, hasDependency, readPackageJson } from "./package-json";
import { detectDevPort, issuerFromPort } from "./port";
import type { Detector, FrameworkFacts } from "./types";

/**
 * Detects an Angular project by its `@angular/core` dependency. The app dir is
 * `src/app` (where the patcher writes `app.ts`/`app.html`), the dev port comes
 * from the project (else the default), and the issuer is derived from it.
 * Angular's dev server (`@angular/build:dev-server`)
 * is Vite-based but configured via `angular.json` + a `proxy.conf.cjs`, not a
 * `vite.config.ts` — handled by the Angular patcher.
 *
 * The managed templates use Angular 17+ control flow (`@if`), and
 * `@zitadel/sdk-angular` peers Angular 17, so an app that provably runs an
 * older version fails fast instead of scaffolding files that won't compile.
 */
export class AngularDetector implements Detector {
  readonly framework = "angular";

  async detect(cwd: string): Promise<FrameworkFacts | null> {
    const pkg = await readPackageJson(cwd).catch(() => undefined);
    if (!pkg || !hasDependency(pkg, "@angular/core")) {
      return null;
    }

    assertDependencyFloor(pkg, {
      dependency: "@angular/core",
      minimum: "17",
      product: "Angular",
      hint: "Upgrade the app to Angular 17 or newer (https://angular.dev/update-guide) and rerun.",
    });

    const devPort = await detectDevPort(cwd, pkg);
    return { id: "angular", appDir: "src/app", devPort, url: issuerFromPort(devPort) };
  }
}
