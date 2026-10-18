import { dependencyVersionMajor, hasDependency, readPackageJson } from "./package-json";
import { detectDevPort, issuerFromPort } from "./port";
import type { Detector, FrameworkFacts } from "./types";
import { enforceVersionFloor } from "./version-floor";

/**
 * Detects a Vite + React single-page app and extracts its facts: the source
 * directory (`src`), the dev-server port (parsed from the `dev` script / env
 * file, else the framework default), and the derived local issuer URL.
 *
 * Recognises a project that depends on both `react` and `vite` but NOT `next`
 * — Next.js ships React too, so the {@link import("./next").NextDetector} must
 * run first (and does, by registry order) and this detector excludes it.
 */
export class ReactDetector implements Detector {
  readonly framework = "react";
  readonly displayName = "React";
  readonly versionPackage = "react";
  readonly versionFloor = "18";

  async detect(cwd: string): Promise<FrameworkFacts | null> {
    const pkg = await readPackageJson(cwd).catch(() => undefined);
    if (
      !pkg ||
      hasDependency(pkg, "next") ||
      !hasDependency(pkg, this.versionPackage) ||
      !hasDependency(pkg, "vite")
    ) {
      return null;
    }

    await enforceVersionFloor(this, pkg, cwd);

    const devPort = await detectDevPort(cwd, pkg);
    const versionMajor = dependencyVersionMajor(pkg, this.versionPackage);
    return {
      id: "react",
      appDir: "src",
      devPort,
      url: issuerFromPort(devPort),
      ...(versionMajor === undefined ? {} : { versionMajor }),
    };
  }
}
