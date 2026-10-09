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

  async detect(cwd: string): Promise<FrameworkFacts | null> {
    const pkg = await readPackageJson(cwd).catch(() => undefined);
    if (
      !pkg ||
      hasDependency(pkg, "next") ||
      hasDependency(pkg, "@tanstack/react-start") ||
      !hasDependency(pkg, "react") ||
      !hasDependency(pkg, "vite")
    ) {
      return null;
    }

    // Supported floor (ADR 043): the SDK wrappers and scaffolded templates
    // target React 18+. Enforced here so setup and doctor share one loud
    // gate; only a spec that provably cannot resolve to 18+ is rejected —
    // protocol specs and dist-tags pass.
    const belowFloor = dependencySpecProvablyBelowMajor(pkg, "react", 18);
    if (belowFloor !== undefined) {
      throw new ZitadelError(
        "E_UNSUPPORTED_PROJECT_SHAPE",
        `React "${belowFloor}" is below the supported floor — the CLI integrates React 18 and newer`,
        { hint: "Upgrade the app to React 18+ and rerun." },
      );
    }

    const devPort = await detectDevPort(cwd, pkg);
    const versionMajor = dependencyVersionMajor(pkg, "react");
    return {
      id: "react",
      appDir: "src",
      devPort,
      url: issuerFromPort(devPort),
      ...(versionMajor === undefined ? {} : { versionMajor }),
    };
  }
}
