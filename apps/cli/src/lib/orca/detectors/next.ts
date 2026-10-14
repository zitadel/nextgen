import { stat } from "node:fs/promises";
import { join } from "node:path";

import { ZitadelError } from "../../errors";
import {
  assertDependencyFloor,
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

    // Supported floor (ADR 043): the scaffolded templates target Next 15
    // (current App Router and request-boundary conventions), and 15.2.3 is
    // the first 15.x that does not skip middleware for a request carrying
    // `x-middleware-subrequest` (CVE-2025-29927), which would bypass the
    // generated `protectedRoutes`. The floor is enforced here so setup and
    // doctor share one loud gate instead of degrading silently; only a spec
    // that provably cannot resolve to 15.2.3+ is rejected, so `^15.0.0`
    // passes (it can resolve to a fixed release) while `15.2.2` and `~15.1.0`
    // do not. Protocol specs and dist-tags pass.
    assertDependencyFloor(pkg, {
      dependency: "next",
      minimum: "15.2.3",
      product: "Next.js",
      hint: "Upgrade the app to Next.js 15.2.3 or later (e.g. `npx @next/codemod@latest upgrade`) and rerun: earlier releases let a request skip middleware (CVE-2025-29927).",
    });

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
