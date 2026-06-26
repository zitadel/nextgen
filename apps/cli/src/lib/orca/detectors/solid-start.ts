import { hasDependency, readPackageJson } from "./package-json";
import { detectDevPort, issuerFromPort } from "./port";
import type { Detector, FrameworkFacts } from "./types";

/**
 * Detects a SolidStart project by its `solid-js` AND `@solidjs/start`
 * dependencies. Like Next.js and Nuxt, SolidStart proxies the auth backend and
 * verifies the session through server middleware (`@zitadel/sdk-solid-start`),
 * not a Vite dev-server proxy — so the patcher wires `src/middleware.ts` and
 * file-based routes.
 *
 * Runs before the Solid detector (which excludes `@solidjs/start`) since
 * SolidStart ships Solid — so a SolidStart project is never mistaken for a bare
 * Solid SPA. Routes/managed files live under `src` (`src/routes`,
 * `src/middleware.ts`).
 */
export class SolidStartDetector implements Detector {
  readonly framework = "solid-start";

  async detect(cwd: string): Promise<FrameworkFacts | null> {
    const pkg = await readPackageJson(cwd).catch(() => undefined);
    if (!pkg || !hasDependency(pkg, "solid-js") || !hasDependency(pkg, "@solidjs/start")) {
      return null;
    }

    const devPort = await detectDevPort(cwd, pkg);
    return { id: "solid-start", appDir: "src", devPort, url: issuerFromPort(devPort) };
  }
}
