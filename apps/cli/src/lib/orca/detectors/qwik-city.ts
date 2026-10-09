import { hasDependency, readPackageJson } from "./package-json";
import { detectDevPort, issuerFromPort } from "./port";
import type { Detector, FrameworkFacts } from "./types";

/**
 * Detects a Qwik City project: depends on both `@builder.io/qwik` and
 * `@builder.io/qwik-city` (the meta-framework, which ships Qwik). Like Next.js
 * and SvelteKit, Qwik City proxies the auth backend and verifies the session
 * through a server entrypoint (`@zitadel/sdk-qwik-city`) — here the
 * `onRequest` plugin in `src/routes/plugin@nextgen.ts`, a plain route file —
 * not a Vite dev-server proxy.
 *
 * Runs before the Qwik detector (which excludes `@builder.io/qwik-city`) since
 * Qwik City ships Qwik — so a Qwik City project is never mistaken for a bare
 * Qwik SPA. Routes/managed files live under `src` (`src/routes`).
 */
export class QwikCityDetector implements Detector {
  readonly framework = "qwik-city";

  async detect(cwd: string): Promise<FrameworkFacts | null> {
    const pkg = await readPackageJson(cwd).catch(() => undefined);
    if (
      !pkg ||
      !hasDependency(pkg, "@builder.io/qwik") ||
      !hasDependency(pkg, "@builder.io/qwik-city")
    ) {
      return null;
    }

    const devPort = await detectDevPort(cwd, pkg);
    return { id: "qwik-city", appDir: "src", devPort, url: issuerFromPort(devPort) };
  }
}
