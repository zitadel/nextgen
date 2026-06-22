import { hasDependency, readPackageJson } from "./package-json";
import { detectDevPort, issuerFromPort } from "./port";
import type { Detector, FrameworkFacts } from "./types";

/**
 * Detects a Vite + Vue single-page app: depends on `vue` and `vite` but NOT
 * `nuxt` (Nuxt is its own meta-framework and ships Vue) — so the source dir is
 * `src`, the dev port comes from the project, and the issuer is derived from it.
 */
export class VueDetector implements Detector {
  readonly framework = "vue";

  async detect(cwd: string): Promise<FrameworkFacts | null> {
    const pkg = await readPackageJson(cwd).catch(() => undefined);
    if (
      !pkg ||
      hasDependency(pkg, "nuxt") ||
      !hasDependency(pkg, "vue") ||
      !hasDependency(pkg, "vite")
    ) {
      return null;
    }

    const devPort = await detectDevPort(cwd, pkg);
    return { id: "vue", appDir: "src", devPort, url: issuerFromPort(devPort) };
  }
}
