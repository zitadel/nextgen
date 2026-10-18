import { stat } from "node:fs/promises";
import { join } from "node:path";

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
 * `appDir` is the Nuxt srcDir. Nuxt 4 keeps `app.vue`/`pages/`/`plugins/` under
 * `app/` but still honours a root-layout app: like Nuxt itself, it falls back to
 * the root when `app/` is absent and the root holds `assets`, `layouts`,
 * `middleware`, `pages` or `plugins`. A fresh project gets `app/`.
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

    const appDir = await detectSrcDir(cwd);
    const devPort = await detectDevPort(cwd, pkg);
    return { id: "nuxt", appDir, devPort, url: issuerFromPort(devPort) };
  }
}

async function detectSrcDir(cwd: string): Promise<string> {
  if (await dirExists(join(cwd, "app"))) {
    return "app";
  }
  for (const dir of ["assets", "layouts", "middleware", "pages", "plugins"]) {
    if (await dirExists(join(cwd, dir))) {
      return ".";
    }
  }
  return "app";
}

async function dirExists(path: string): Promise<boolean> {
  return stat(path).then(
    (s) => s.isDirectory(),
    () => false,
  );
}
