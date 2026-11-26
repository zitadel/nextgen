import { isErrno } from "@/lib/errno";
import { PmManifestInvalidError } from "@/lib/pm";
import { hasDependency, readPackageJson } from "./package-json";
import { detectDevPort, issuerFromPort } from "./port";
import type { Detector, FrameworkFacts } from "./types";
import { enforceVersionFloor } from "./version-floor";

/**
 * Detects a Vite + Vue single-page app: depends on `vue` and `vite` but NOT
 * `nuxt` (Nuxt is its own meta-framework and ships Vue) — so the source dir is
 * `src`, the dev port comes from the project, and the issuer is derived from it.
 */
export class VueDetector implements Detector {
  readonly framework = "vue";
  readonly displayName = "Vue";
  readonly versionPackage = "vue";
  readonly versionFloor = "3.2";

  async detect(cwd: string): Promise<FrameworkFacts | null> {
    try {
      const pkg = await readPackageJson(cwd);
      if (
        hasDependency(pkg, "nuxt") ||
        !hasDependency(pkg, this.versionPackage) ||
        !hasDependency(pkg, "vite")
      ) {
        return null;
      }

      await enforceVersionFloor(this, pkg, cwd);

      const devPort = await detectDevPort(cwd, pkg);
      return { id: "vue", appDir: "src", devPort, url: issuerFromPort(devPort) };
    } catch (error) {
      if (isErrno(error, "ENOENT")) {
        return null;
      }
      if (error instanceof PmManifestInvalidError) {
        return null;
      }
      throw error;
    }
  }
}
