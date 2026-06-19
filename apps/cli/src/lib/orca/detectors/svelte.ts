import { hasDependency, readPackageJson } from "./package-json";
import { detectDevPort, issuerFromPort } from "./port";
import type { Detector, FrameworkFacts } from "./types";

/**
 * Detects a Vite + Svelte single-page app: depends on `svelte` and `vite` but
 * NOT `@sveltejs/kit` (SvelteKit is its own meta-framework and ships Svelte).
 * The source dir is `src`, the dev port comes from the project, and the issuer
 * is derived from it.
 */
export class SvelteDetector implements Detector {
  readonly framework = "svelte";

  async detect(cwd: string): Promise<FrameworkFacts | null> {
    const pkg = await readPackageJson(cwd).catch(() => undefined);
    if (
      !pkg ||
      hasDependency(pkg, "@sveltejs/kit") ||
      !hasDependency(pkg, "svelte") ||
      !hasDependency(pkg, "vite")
    ) {
      return null;
    }

    const devPort = await detectDevPort(cwd, pkg);
    return { id: "svelte", appDir: "src", devPort, url: issuerFromPort(devPort) };
  }
}
