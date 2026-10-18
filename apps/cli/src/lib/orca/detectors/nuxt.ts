import { hasDependency, readPackageJson } from "./package-json";
import { detectDevPort, issuerFromPort } from "./port";
import type { Detector, FrameworkFacts } from "./types";
import { enforceVersionFloor } from "./version-floor";

/**
 * Detects a Nuxt project by its `nuxt` dependency. Like Next.js, Nuxt proxies
 * the auth backend through server middleware (`@zitadel/sdk-nuxt`), not a Vite
 * dev-server proxy — so the patcher wires the module + a `nuxt.config.ts` edit.
 * Runs before the Vue detector (which excludes Nuxt) since Nuxt ships Vue.
 *
 * `appDir` is the Nuxt srcDir. The floor is Nuxt 4, which keeps
 * `app.vue`/`pages/`/`plugins/` under `app/`, so the patcher writes its files there.
 */
export class NuxtDetector implements Detector {
  readonly framework = "nuxt";
  readonly displayName = "Nuxt";
  readonly versionPackage = "nuxt";
  readonly versionFloor = "4";

  async detect(cwd: string): Promise<FrameworkFacts | null> {
    const pkg = await readPackageJson(cwd).catch(() => undefined);
    if (!pkg || !hasDependency(pkg, this.versionPackage)) {
      return null;
    }

    await enforceVersionFloor(this, pkg, cwd);

    const devPort = await detectDevPort(cwd, pkg);
    return { id: "nuxt", appDir: "app", devPort, url: issuerFromPort(devPort) };
  }
}
