import type { Detector, FrameworkFacts } from "./types";

import { hasDependency, readPackageJson } from "./package-json";
import { detectDevPort, issuerFromPort } from "./port";

/**
 * Detects a Vite + Qwik 2 single-page app: depends on `@qwik.dev/core` and
 * `vite` but NOT `@qwik.dev/router` (Qwik's meta-framework, formerly Qwik City,
 * is its own thing and ships Qwik). `@zitadel/sdk-qwik` requires Qwik 2, so a
 * Qwik 1 app (`@builder.io/qwik`) is intentionally not matched — it would get an
 * incompatible SDK peer. The source dir is `src`, the dev port comes from the
 * project, and the issuer is derived from it.
 */
export class QwikDetector implements Detector {
  readonly framework = "qwik";

  async detect(cwd: string): Promise<FrameworkFacts | null> {
    const pkg = await readPackageJson(cwd).catch(() => undefined);
    if (
      !pkg ||
      hasDependency(pkg, "@qwik.dev/router") ||
      !hasDependency(pkg, "@qwik.dev/core") ||
      !hasDependency(pkg, "vite")
    ) {
      return null;
    }

    const devPort = await detectDevPort(cwd, pkg);
    return { id: "qwik", appDir: "src", devPort, url: issuerFromPort(devPort) };
  }
}
