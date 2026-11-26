import { FsNotFoundError, stat } from "@/lib/fs";
import { PmManifestInvalidError } from "@/lib/pm";
import { join } from "node:path";

import { OrcaFrameworkUnsupportedError } from "@/lib/orca/errors";

import { dependencyVersionMajor, hasDependency, readPackageJson } from "./package-json";
import { detectDevPort, issuerFromPort } from "./port";
import type { Detector, FrameworkFacts } from "./types";
import { enforceVersionFloor } from "./version-floor";

/**
 * Detects a Next.js App Router project and extracts its facts: the App Router
 * directory (`app` vs `src/app`), the dev-server port (parsed from the `dev`
 * script / env file, else 3000), and the derived local issuer URL. Owns every
 * Next-specific assumption so the orchestrator and commands stay generic.
 */
export class NextDetector implements Detector {
  readonly framework = "next";
  readonly displayName = "Next.js";
  readonly versionPackage = "next";
  readonly versionFloor = "15.2.3";
  readonly versionFloorNote = "Earlier releases let a request skip middleware (CVE-2025-29927).";

  /**
   * Returns `null` when `cwd` is not a Next.js project (no `next` dependency),
   * so the orchestrator can try other detectors. Throws
   * `E_UNSUPPORTED_PROJECT_SHAPE` when it is Next.js but lacks an App Router
   * directory (e.g. a Pages Router project), which is a hard error rather than
   * an empty directory to scaffold.
   */
  async detect(cwd: string): Promise<FrameworkFacts | null> {
    try {
      const pkg = await readPackageJson(cwd);
      if (!hasDependency(pkg, "next")) {
        return null;
      }

      await enforceVersionFloor(this, pkg, cwd);

      const appDir = (await dirExists(join(cwd, "app")))
        ? "app"
        : (await dirExists(join(cwd, "src/app")))
          ? "src/app"
          : undefined;
      if (!appDir) {
        throw new OrcaFrameworkUnsupportedError(
          "Next.js Pages Router projects are not supported in v1; create an App Router project with an app/ or src/app/ directory",
        );
      }

      const devPort = await detectDevPort(cwd, pkg);
      const versionMajor = dependencyVersionMajor(pkg, "next");
      return {
        id: "next",
        appDir,
        devPort,
        url: issuerFromPort(devPort),
        ...(versionMajor === undefined ? {} : { versionMajor }),
      };
    } catch (error) {
      if (error instanceof FsNotFoundError) {
        return null;
      }
      if (error instanceof PmManifestInvalidError) {
        return null;
      }
      throw error;
    }
  }
}

async function dirExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (error) {
    if (error instanceof FsNotFoundError) {
      return false;
    }
    throw error;
  }
}
