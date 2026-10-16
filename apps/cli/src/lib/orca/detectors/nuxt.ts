import { stat } from "node:fs/promises";
import { join } from "node:path";

import { assertDependencyFloor, hasDependency, readPackageJson } from "./package-json";
import { detectDevPort, issuerFromPort } from "./port";
import type { Detector, FrameworkFacts } from "./types";

/**
 * Detects a Nuxt project by its `nuxt` dependency. Like Next.js, Nuxt proxies
 * the auth backend through server middleware (`@zitadel/sdk-nuxt`), not a Vite
 * dev-server proxy — so the patcher wires the module + a `nuxt.config.ts` edit.
 * Runs before the Vue detector (which excludes Nuxt) since Nuxt ships Vue.
 *
 * `appDir` tracks the Nuxt srcDir: Nuxt 4 (what `nuxi init` now scaffolds) keeps
 * `app.vue`/`pages/`/`plugins/` under `app/`, while a project that opted out of
 * the `app/` layout keeps them at the root — so the patcher writes its files
 * relative to whichever this project uses.
 *
 * `@zitadel/sdk-nuxt` peers Nuxt 4, so a Nuxt 3 app is refused here rather
 * than failing at install with a peer-dependency conflict after setup has
 * written its files and created the project.
 */
export class NuxtDetector implements Detector {
  readonly framework = "nuxt";

  async detect(cwd: string): Promise<FrameworkFacts | null> {
    const pkg = await readPackageJson(cwd).catch(() => undefined);
    if (!pkg || !hasDependency(pkg, "nuxt")) {
      return null;
    }

    assertDependencyFloor(pkg, {
      dependency: "nuxt",
      minimum: "4",
      product: "Nuxt",
      hint: "Upgrade the app to Nuxt 4 (`npx nuxi@latest upgrade`) and rerun.",
    });

    const appDir = (await dirExists(join(cwd, "app"))) ? "app" : ".";
    const devPort = await detectDevPort(cwd, pkg);
    return { id: "nuxt", appDir, devPort, url: issuerFromPort(devPort) };
  }
}

async function dirExists(path: string): Promise<boolean> {
  return stat(path).then(
    (s) => s.isDirectory(),
    () => false,
  );
}
