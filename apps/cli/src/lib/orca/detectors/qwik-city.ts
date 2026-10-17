import { hasDependency, readPackageJson } from "./package-json";
import { detectDevPort, issuerFromPort } from "./port";
import type { Detector, FrameworkFacts } from "./types";

/**
 * Detects a Qwik City project on Qwik 2: depends on both `@qwik.dev/core` and
 * `@qwik.dev/router` (the meta-framework, renamed from `@builder.io/qwik-city`
 * in Qwik 2). Like Next.js and SvelteKit, Qwik City proxies the auth backend and
 * verifies the session through a server entrypoint (`@zitadel/sdk-qwik-city`) —
 * here the `onRequest` plugin in `src/routes/plugin@nextgen.ts`, a plain route
 * file — not a Vite dev-server proxy.
 *
 * A Qwik 1 app (`@builder.io/qwik` + `@builder.io/qwik-city`) is intentionally
 * not matched, like the Qwik detector: its pages render the `@zitadel/sdk-qwik`
 * widgets, which require Qwik 2, so it would get an SDK it cannot install.
 *
 * Runs before the Qwik detector (which excludes `@qwik.dev/router`) since Qwik
 * City ships Qwik — so a Qwik City project is never mistaken for a bare Qwik
 * SPA. Routes/managed files live under `src` (`src/routes`).
 */
export class QwikCityDetector implements Detector {
  readonly framework = "qwik-city";

  async detect(cwd: string): Promise<FrameworkFacts | null> {
    const pkg = await readPackageJson(cwd).catch(() => undefined);
    if (!pkg || !hasDependency(pkg, "@qwik.dev/core") || !hasDependency(pkg, "@qwik.dev/router")) {
      return null;
    }

    const devPort = await detectDevPort(cwd, pkg);
    return { id: "qwik-city", appDir: "src", devPort, url: issuerFromPort(devPort) };
  }
}
