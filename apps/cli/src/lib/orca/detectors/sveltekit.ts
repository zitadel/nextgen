import { hasDependency, readPackageJson } from "./package-json";
import { detectDevPort, issuerFromPort } from "./port";
import type { Detector, FrameworkFacts } from "./types";
import { enforceVersionFloor } from "./version-floor";

/**
 * Detects a SvelteKit project by its `@sveltejs/kit` dependency. Like Next.js
 * and Nuxt, SvelteKit proxies the auth backend and verifies the session through
 * a server hook (`@zitadel/sdk-sveltekit`), not a Vite dev-server proxy — so the
 * patcher wires `src/hooks.server.ts` and file-based routes.
 *
 * Runs before the Svelte detector (which excludes SvelteKit) since SvelteKit
 * ships Svelte — so a SvelteKit project is never mistaken for a bare Svelte SPA.
 * Routes/managed files live under `src` (`src/routes`, `src/hooks.server.ts`).
 * SvelteKit 3 is the floor: the hook reads its settings from `$app/env/private`,
 * which SvelteKit 2 does not have.
 */
export class SvelteKitDetector implements Detector {
  readonly framework = "sveltekit";
  readonly displayName = "SvelteKit";
  readonly versionPackage = "@sveltejs/kit";
  readonly versionFloor = "3";

  async detect(cwd: string): Promise<FrameworkFacts | null> {
    const pkg = await readPackageJson(cwd).catch(() => undefined);
    if (!pkg || !hasDependency(pkg, "@sveltejs/kit")) {
      return null;
    }

    await enforceVersionFloor(this, pkg, cwd);

    // The widgets come from @zitadel/sdk-svelte, which peers Svelte 5 and is
    // written with runes; a Svelte 4 app cannot install or compile it.
    await enforceVersionFloor(
      { displayName: "Svelte", versionPackage: "svelte", versionFloor: "5" },
      pkg,
      cwd,
    );

    const devPort = await detectDevPort(cwd, pkg);
    return { id: "sveltekit", appDir: "src", devPort, url: issuerFromPort(devPort) };
  }
}
