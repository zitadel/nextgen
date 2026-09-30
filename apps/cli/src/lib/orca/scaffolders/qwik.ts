import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { AbstractCLIScaffolder } from "./cli";

/** Qwik 2 version the generated app is migrated to — matches the peer range of
 * `@zitadel/sdk-qwik`, which requires Qwik 2 (`@qwik.dev/core`). */
const QWIK2_VERSION = "^2.0.0-beta.45";

/**
 * Scaffolds a new Vite + Qwik (TypeScript) single-page app with `create-vite`,
 * then removes the starter `app.tsx`/`app.css` demo so the patcher can write the
 * managed `src/app.tsx` without colliding with boilerplate. The create-vite Qwik
 * template uses a lowercase `app.tsx` (named `App` export, mounted by `main.tsx`)
 * — the patched file keeps that same entry.
 *
 * `create-vite`'s `qwik-ts` template still ships Qwik 1 (`@builder.io/qwik`) on
 * Vite 8, but Qwik 1 peers `vite ">=5 <8"` (so a bare install ERESOLVEs) and
 * `@zitadel/sdk-qwik` now requires Qwik 2. So the generated app is migrated to
 * Qwik 2 (`@qwik.dev/core`), which runs on Vite 8 — the template's Vite version
 * is left untouched, no downgrade needed.
 */
export class QwikScaffolder extends AbstractCLIScaffolder {
  readonly displayName = "Qwik (Vite)";
  readonly supportedFrameworks: ReadonlyArray<string> = ["qwik"];

  async scaffold(cwd: string, _framework: string): Promise<void> {
    this.runCommand("npm", ["create", "vite@latest", ".", "--", "--template", "qwik-ts"], cwd);
    await rm(join(cwd, "src/app.tsx"), { force: true });
    await rm(join(cwd, "src/app.css"), { force: true });
    await this.migrateToQwik2(cwd);
  }

  /**
   * Repoints the generated app from Qwik 1 to Qwik 2: swaps the `@builder.io/qwik`
   * dependency for `@qwik.dev/core` in `package.json` and rewrites the `@builder.io/qwik`
   * references create-vite emits in `vite.config.ts` (`/optimizer`), `src/main.tsx`
   * (the runtime and `/qwikloader.js`), and `tsconfig.app.json` (`jsxImportSource`,
   * which `tsc -b && vite build` needs). Edits `package.json` directly rather than
   * via `npm pkg`, which cannot address keys containing dots (`@builder.io/qwik`,
   * `@qwik.dev/core`). No-ops cleanly if a future template already ships Qwik 2.
   */
  private async migrateToQwik2(cwd: string): Promise<void> {
    const pkgPath = join(cwd, "package.json");
    const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    for (const field of ["dependencies", "devDependencies"] as const) {
      delete pkg[field]?.["@builder.io/qwik"];
    }
    pkg.dependencies = { ...pkg.dependencies, "@qwik.dev/core": QWIK2_VERSION };
    await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
    for (const file of ["vite.config.ts", "src/main.tsx", "tsconfig.app.json"]) {
      await this.repointQwikRefs(join(cwd, file));
    }
  }

  /** Rewrites every `@builder.io/qwik…` reference (import specifier or
   * `jsxImportSource`) to `@qwik.dev/core…` in one generated file. Skips a file
   * that is absent or already migrated. */
  private async repointQwikRefs(file: string): Promise<void> {
    const source = await readFile(file, "utf8").catch(() => null);
    if (source === null || !source.includes("@builder.io/qwik")) {
      return;
    }
    await writeFile(file, source.replaceAll("@builder.io/qwik", "@qwik.dev/core"));
  }
}
