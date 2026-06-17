import { hasDependency, readPackageJson } from "./package-json";
import { detectDevPort, issuerFromPort } from "./port";
import type { Detector, FrameworkFacts } from "./types";

/**
 * Detects a Vite + Solid single-page app: depends on `solid-js` and `vite` but
 * NOT `@solidjs/start` (SolidStart is its own meta-framework and ships Solid).
 * The source dir is `src`, the dev port comes from the project, and the issuer
 * is derived from it.
 */
export class SolidDetector implements Detector {
  readonly framework = "solid";

  async detect(cwd: string): Promise<FrameworkFacts | null> {
    const pkg = await readPackageJson(cwd).catch(() => undefined);
    if (
      !pkg ||
      hasDependency(pkg, "@solidjs/start") ||
      !hasDependency(pkg, "solid-js") ||
      !hasDependency(pkg, "vite")
    ) {
      return null;
    }

    const devPort = await detectDevPort(cwd, pkg);
    return { id: "solid", appDir: "src", devPort, url: issuerFromPort(devPort) };
  }
}
