import { stat } from "node:fs/promises";
import { join } from "node:path";

import { ZitadelError } from "../../errors";
import {
  dependencySpecProvablyBelowMajor,
  dependencyVersionMajor,
  hasDependency,
  readPackageJson,
} from "./package-json";
import { detectDevPort, issuerFromPort } from "./port";
import type { Detector, FrameworkFacts } from "./types";

/**
 * Detects a Next.js App Router project and extracts its facts: the App Router
 * directory (`app` vs `src/app`), the dev-server port (parsed from the `dev`
 * script / env file, else 3000), and the derived local issuer URL. Owns every
 * Next-specific assumption so the orchestrator and commands stay generic.
 */
export class NextDetector implements Detector {
  readonly framework = "next";

  /**
   * Returns `null` when `cwd` is not a Next.js project (no `next` dependency),
   * so the orchestrator can try other detectors. Throws
   * `E_UNSUPPORTED_PROJECT_SHAPE` when it is Next.js but lacks an App Router
   * directory (e.g. a Pages Router project), which is a hard error rather than
   * an empty directory to scaffold.
   */
  async detect(cwd: string): Promise<FrameworkFacts | null> {
    const pkg = await readPackageJson(cwd).catch(() => undefined);
    if (!pkg || !hasDependency(pkg, "next")) {
      return null;
    }

    // Supported floor (ADR 043): the scaffolded templates target Next 15+
    // (current App Router and request-boundary conventions). The floor is
    // enforced here so setup and doctor share one loud gate instead of
    // degrading silently; only a spec that provably cannot resolve to 15+
    // is rejected — protocol specs and dist-tags pass.
    const belowFloor = dependencySpecProvablyBelowMajor(pkg, "next", 15);
    if (belowFloor !== undefined) {
      throw new ZitadelError(
        "E_UNSUPPORTED_PROJECT_SHAPE",
        `Next.js "${belowFloor}" is below the supported floor — the CLI integrates Next.js 15 and newer`,
        { hint: "Upgrade the app to Next 15+ (e.g. `npx @next/codemod@latest upgrade`) and rerun." },
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
    const versionMajor = dependencyVersionMajor(pkg, "next");
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
