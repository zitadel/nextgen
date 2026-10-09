import { hasDependency, readPackageJson } from "./package-json";
import { detectDevPort, issuerFromPort } from "./port";
import type { Detector, FrameworkFacts } from "./types";

/**
 * Detects a TanStack Start project by its `@tanstack/react-start` dependency
 * (alongside `react`). TanStack Start runs on Vite + React, so the
 * {@link import("./react").ReactDetector} would also match — this detector must
 * run first (and does, by registry order), and the React detector excludes
 * `@tanstack/react-start` so a TanStack Start app is never mistaken for a bare
 * Vite + React SPA.
 *
 * Like Next.js and SvelteKit, TanStack Start proxies the auth backend and
 * verifies the session through a server entrypoint — here the
 * `@zitadel/sdk-tanstack-start` request middleware registered in `src/start.ts`
 * — so the patcher wires that file and file-based routes under `src`.
 */
export class TanStackStartDetector implements Detector {
  readonly framework = "tanstack-start";

  async detect(cwd: string): Promise<FrameworkFacts | null> {
    const pkg = await readPackageJson(cwd).catch(() => undefined);
    if (!pkg || !hasDependency(pkg, "react") || !hasDependency(pkg, "@tanstack/react-start")) {
      return null;
    }

    const devPort = await detectDevPort(cwd, pkg);
    return { id: "tanstack-start", appDir: "src", devPort, url: issuerFromPort(devPort) };
  }
}
