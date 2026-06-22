import { hasDependency, readPackageJson } from "./package-json";
import { detectDevPort, issuerFromPort } from "./port";
import type { Detector, FrameworkFacts } from "./types";

/**
 * Detects a SvelteKit project by its `@sveltejs/kit` dependency. Like Next.js
 * and Nuxt, SvelteKit proxies the auth backend and verifies the session through
 * a server hook (`@zitadel/sdk-sveltekit`), not a Vite dev-server proxy — so the
 * patcher wires `src/hooks.server.ts` and file-based routes.
 *
 * Runs before the Svelte detector (which excludes SvelteKit) since SvelteKit
 * ships Svelte — so a SvelteKit project is never mistaken for a bare Svelte SPA.
 * Routes/managed files live under `src` (`src/routes`, `src/hooks.server.ts`).
 */
export class SvelteKitDetector implements Detector {
  readonly framework = "sveltekit";

  async detect(cwd: string): Promise<FrameworkFacts | null> {
    const pkg = await readPackageJson(cwd).catch(() => undefined);
    if (!pkg || !hasDependency(pkg, "@sveltejs/kit")) {
      return null;
    }

    const devPort = await detectDevPort(cwd, pkg);
    return { id: "sveltekit", appDir: "src", devPort, url: issuerFromPort(devPort) };
  }
}
