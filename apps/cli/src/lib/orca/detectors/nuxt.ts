import { hasDependency, readPackageJson } from "./package-json";
import { detectDevPort, issuerFromPort } from "./port";
import type { Detector, FrameworkFacts } from "./types";

/**
 * Detects a Nuxt project by its `nuxt` dependency. Like Next.js, Nuxt proxies
 * the auth backend through server middleware (`@zitadel/sdk-nuxt`), not a Vite
 * dev-server proxy — so the patcher wires the module + a `nuxt.config.ts` edit.
 * Runs before the Vue detector (which excludes Nuxt) since Nuxt ships Vue.
 */
export class NuxtDetector implements Detector {
  readonly framework = "nuxt";

  async detect(cwd: string): Promise<FrameworkFacts | null> {
    const pkg = await readPackageJson(cwd).catch(() => undefined);
    if (!pkg || !hasDependency(pkg, "nuxt")) {
      return null;
    }

    const devPort = await detectDevPort(cwd, pkg);
    return { id: "nuxt", appDir: ".", devPort, url: issuerFromPort(devPort) };
  }
}
