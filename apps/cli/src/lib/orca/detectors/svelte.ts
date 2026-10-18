import { ZitadelError } from "../../errors";
import { dependencySpecProvablyBelowMajor, hasDependency, readPackageJson } from "./package-json";
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
  readonly displayName = "Svelte";
  readonly versionPackage = "svelte";

  async detect(cwd: string): Promise<FrameworkFacts | null> {
    const pkg = await readPackageJson(cwd).catch(() => undefined);
    if (
      !pkg ||
      hasDependency(pkg, "@sveltejs/kit") ||
      !hasDependency(pkg, this.versionPackage) ||
      !hasDependency(pkg, "vite")
    ) {
      return null;
    }

    // The widgets come from @zitadel/sdk-svelte, which peers Svelte 5 and is
    // written with runes; a Svelte 4 app cannot install or compile it.
    const belowFloor = dependencySpecProvablyBelowMajor(pkg, "svelte", 5);
    if (belowFloor !== undefined) {
      throw new ZitadelError(
        "E_UNSUPPORTED_PROJECT_SHAPE",
        `Svelte "${belowFloor}" is below the supported floor — the CLI integrates Svelte 5 and newer`,
        { hint: "Upgrade the app to Svelte 5 and rerun." },
      );
    }

    const devPort = await detectDevPort(cwd, pkg);
    return { id: "svelte", appDir: "src", devPort, url: issuerFromPort(devPort) };
  }
}
