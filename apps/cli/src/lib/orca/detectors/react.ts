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
 * or `@tanstack/react-start` — Next.js and TanStack Start both ship React too,
 * so their detectors must run first (and do, by registry order) and this
 * detector excludes them so a meta-framework app is never seen as a bare SPA.
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
      hasDependency(pkg, "@tanstack/react-start") ||
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
