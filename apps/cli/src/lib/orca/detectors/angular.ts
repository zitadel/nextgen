import { ZitadelError } from "../../errors";
import { hasDependency, readPackageJson } from "./package-json";
import { detectDevPort, issuerFromPort } from "./port";
import type { Detector, FrameworkFacts } from "./types";

/** The lowest Angular major the generated templates compile on. */
const MIN_ANGULAR_MAJOR = 17;

/** Best-effort major version from a dependency range (`^17.3.0` → 17). */
function angularMajor(spec: string): number | undefined {
  const match = spec.match(/\d+/);
  return match ? Number.parseInt(match[0], 10) : undefined;
}

/**
 * Detects an Angular project by its `@angular/core` dependency. The app dir is
 * `src/app` (where the patcher writes `app.ts`/`app.html`), the dev port comes
 * from the project (else the default), and the issuer is derived from it.
 * Angular's dev server (`@angular/build:dev-server`)
 * is Vite-based but configured via `angular.json` + a `proxy.conf.cjs`, not a
 * `vite.config.ts` — handled by the Angular patcher.
 *
 * The managed templates use Angular 17+ control flow (`@if`), so a clearly
 * older project fails fast with `E_VALIDATION` instead of scaffolding files
 * that won't compile.
 */
export class AngularDetector implements Detector {
  readonly framework = "angular";

  async detect(cwd: string): Promise<FrameworkFacts | null> {
    const pkg = await readPackageJson(cwd).catch(() => undefined);
    if (!pkg || !hasDependency(pkg, "@angular/core")) {
      return null;
    }

    const spec = pkg.dependencies?.["@angular/core"] ?? pkg.devDependencies?.["@angular/core"];
    const major = spec ? angularMajor(spec) : undefined;
    if (major !== undefined && major < MIN_ANGULAR_MAJOR) {
      throw new ZitadelError(
        "E_VALIDATION",
        `Angular ${major} is unsupported — the generated auth templates use Angular ${MIN_ANGULAR_MAJOR}+ control flow (@if).`,
        {
          hint: `Upgrade to Angular ${MIN_ANGULAR_MAJOR} or newer before running setup, or add the Zitadel components to your templates manually.`,
        },
      );
    }

    const devPort = await detectDevPort(cwd, pkg);
    return { id: "angular", appDir: "src/app", devPort, url: issuerFromPort(devPort) };
  }
}
