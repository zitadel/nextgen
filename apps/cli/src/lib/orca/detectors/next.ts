import { stat } from "node:fs/promises";
import { join } from "node:path";

import { ZitadelError } from "../../errors";
import {
  dependencySpecProvablyBelow,
  dependencyVersionMajor,
  hasDependency,
  installedVersionBelow,
  readPackageJson,
} from "./package-json";
import { detectDevPort, issuerFromPort } from "./port";
import type { Detector, FrameworkFacts } from "./types";

/** The oldest Next.js the CLI integrates; see {@link NextDetector.detect}. */
const NEXT_FLOOR = "15.2.3";

const NEXT_FLOOR_HINT =
  "Upgrade the app to Next.js 15.2.3 or later (e.g. `npx @next/codemod@latest upgrade`) and rerun: earlier releases let a request skip middleware (CVE-2025-29927).";

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

  /**
   * Returns `null` when `cwd` is not a Next.js project (no `next` dependency),
   * so the orchestrator can try other detectors. Throws
   * `E_UNSUPPORTED_PROJECT_SHAPE` when it is Next.js but lacks an App Router
   * directory (e.g. a Pages Router project), which is a hard error rather than
   * an empty directory to scaffold.
   */
  async detect(cwd: string): Promise<FrameworkFacts | null> {
    const pkg = await readPackageJson(cwd).catch(() => undefined);
    if (!pkg || !hasDependency(pkg, this.versionPackage)) {
      return null;
    }

    // Supported floor (ADR 043): the scaffolded templates target Next 15
    // (current App Router and request-boundary conventions), and 15.2.3 is
    // the first 15.x that does not skip middleware for a request carrying
    // `x-middleware-subrequest` (CVE-2025-29927), which would bypass the
    // generated `protectedRoutes`. The floor is enforced here so setup and
    // doctor share one loud gate instead of degrading silently. The declared
    // spec is refused only when it provably cannot resolve to 15.2.3+, so
    // `^15.0.0` passes while `15.2.2` and `~15.1.0` do not; protocol specs
    // and dist-tags pass. What is installed is judged too: `^15.0.0` with
    // 15.2.2 in node_modules still runs the vulnerable release. With nothing
    // installed, the spec is the only gate.
    const belowFloor = dependencySpecProvablyBelow(pkg, "next", NEXT_FLOOR);
    if (belowFloor !== undefined) {
      throw new ZitadelError(
        "E_UNSUPPORTED_PROJECT_SHAPE",
        `Next.js "${belowFloor}" is below the supported floor — the CLI integrates Next.js ${NEXT_FLOOR} and newer`,
        { hint: NEXT_FLOOR_HINT },
      );
    }
    const installed = await installedVersionBelow(cwd, "next", NEXT_FLOOR);
    if (installed !== undefined) {
      throw new ZitadelError(
        "E_UNSUPPORTED_PROJECT_SHAPE",
        `Next.js ${installed.version} is installed (${installed.path}), below the supported floor — the CLI integrates Next.js ${NEXT_FLOOR} and newer`,
        { hint: NEXT_FLOOR_HINT },
      );
    }

    const appDir = (await dirExists(join(cwd, "app")))
      ? "app"
      : (await dirExists(join(cwd, "src/app")))
        ? "src/app"
        : undefined;
    if (!appDir) {
      throw new ZitadelError(
        "E_UNSUPPORTED_PROJECT_SHAPE",
        "Next.js Pages Router projects are not supported in v1",
        { hint: "Create an App Router project with an app/ or src/app/ directory." },
      );
    }

    const devPort = await detectDevPort(cwd, pkg);
    const versionMajor = dependencyVersionMajor(pkg, this.versionPackage);
    return {
      id: "next",
      appDir,
      devPort,
      url: issuerFromPort(devPort),
      ...(versionMajor === undefined ? {} : { versionMajor }),
    };
  }
}

async function dirExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      return false;
    }
    throw error;
  }
}
