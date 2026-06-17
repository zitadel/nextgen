import { hasDependency, readPackageJson } from "./package-json";
import { detectDevPort, issuerFromPort } from "./port";
import type { Detector, FrameworkFacts } from "./types";

/**
 * Detects a Vite + Qwik single-page app: depends on `@builder.io/qwik` and
 * `vite` but NOT `@builder.io/qwik-city` (Qwik City is its own meta-framework
 * and ships Qwik). The source dir is `src`, the dev port comes from the
 * project, and the issuer is derived from it.
 */
export class QwikDetector implements Detector {
  readonly framework = "qwik";

  async detect(cwd: string): Promise<FrameworkFacts | null> {
    const pkg = await readPackageJson(cwd).catch(() => undefined);
    if (
      !pkg ||
      hasDependency(pkg, "@builder.io/qwik-city") ||
      !hasDependency(pkg, "@builder.io/qwik") ||
      !hasDependency(pkg, "vite")
    ) {
      return null;
    }

    const devPort = await detectDevPort(cwd, pkg);
    return { id: "qwik", appDir: "src", devPort, url: issuerFromPort(devPort) };
  }
}
