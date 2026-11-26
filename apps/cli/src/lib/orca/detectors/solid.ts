import { isErrno } from "@/lib/errno";
import { PmManifestInvalidError } from "@/lib/pm";
import type { PackageJson } from "@/lib/pm";
import { hasDependency, readPackageJson } from "./package-json";
import { detectDevPort, issuerFromPort } from "./port";
import type { Detector, FrameworkFacts } from "./types";
import { enforceVersionFloor } from "./version-floor";

/**
 * Detects a Vite + Solid single-page app: depends on `solid-js` and `vite` but
 * NOT `@solidjs/start` (SolidStart is its own meta-framework and ships Solid).
 * The source dir is `src`, the dev port comes from the project, and the issuer
 * is derived from it.
 */
export class SolidDetector implements Detector {
  readonly framework = "solid";
  readonly displayName = "Solid";
  readonly versionPackage = "solid-js";
  readonly versionFloor = "1.6";

  async detect(cwd: string): Promise<FrameworkFacts | null> {
    // biome-ignore lint/plugin: the checks after the read need `pkg` and must not sit inside the try that guards it
    let pkg: PackageJson;
    try {
      pkg = await readPackageJson(cwd);
    } catch (error) {
      if (isErrno(error, "ENOENT")) {
        return null;
      }
      if (error instanceof PmManifestInvalidError) {
        return null;
      }
      throw error;
    }
    if (
      hasDependency(pkg, "@solidjs/start") ||
      !hasDependency(pkg, this.versionPackage) ||
      !hasDependency(pkg, "vite")
    ) {
      return null;
    }

    await enforceVersionFloor(this, pkg, cwd);

    const devPort = await detectDevPort(cwd, pkg);
    return { id: "solid", appDir: "src", devPort, url: issuerFromPort(devPort) };
  }
}
