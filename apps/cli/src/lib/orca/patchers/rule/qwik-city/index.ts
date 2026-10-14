import { join } from "node:path";

import { npmDistTagForCliVersion } from "../../../../public-cli";
import type { FileOp } from "../file-writer/types";
import type { PatchContext, PatchView } from "../../types";
import { AbstractRulePatcher } from "../base";
import { devScriptPortOp } from "../dev-script-port";
import {
  indexPageTemplate,
  loginPageTemplate,
  pluginTemplate,
  profilePageTemplate,
  registerPageTemplate,
} from "./templates";

const SDK_DEPENDENCY = "@zitadel/sdk-qwik-city";
/**
 * The idiomatic Qwik component library that ships the `<ZitadelLogin>` /
 * `<ZitadelLogout>` Qwik components the routes render. The server SDK above is
 * plumbing only; the widget comes from here, so a Qwik City app gets the native
 * Qwik component (typed props, callback events) rather than the bare element.
 */
const COMPONENT_DEPENDENCY = "@zitadel/sdk-qwik";

/**
 * Rule-based patcher for a Qwik City app. Like Next.js and SvelteKit, Qwik City
 * proxies the backend and verifies the session through a server entrypoint —
 * here the `@zitadel/sdk-qwik-city` `onRequest` plugin in
 * `src/routes/plugin@nextgen.ts`. Contributes the landing/login/register/profile
 * file-based routes (the idiomatic `<ZitadelLogin>`/`<ZitadelLogout>` Qwik
 * components from `@zitadel/sdk-qwik`), the public project-id env var, and both
 * deps. No config edit is needed — the plugin is a plain route file, so (like
 * Next) every managed file carries the marker.
 */
export class QwikCityPatcher extends AbstractRulePatcher {
  canPatch(framework: string): boolean {
    return framework === "qwik-city";
  }

  protected routeOps(ctx: PatchContext): FileOp[] {
    const src = (rel: string) => join(ctx.framework.appDir, rel);
    return [
      { kind: "write", path: src("routes/plugin@nextgen.ts"), contents: pluginTemplate() },
      { kind: "write", path: src("routes/index.tsx"), contents: indexPageTemplate() },
      { kind: "write", path: src("routes/login/index.tsx"), contents: loginPageTemplate() },
      { kind: "write", path: src("routes/register/index.tsx"), contents: registerPageTemplate() },
      { kind: "write", path: src("routes/profile/index.tsx"), contents: profilePageTemplate() },
      // Pin the dev script to the origin setup registered; --strictPort makes
      // Vite exit instead of drifting to a port the project does not allow.
      devScriptPortOp(ctx.issuer, { strictPort: true }),
      { kind: "merge-env", path: ".env.example", entries: { PUBLIC_ZITADEL_PROJECT_ID: "" } },
      {
        kind: "merge-env",
        path: ".env.local",
        entries: { PUBLIC_ZITADEL_PROJECT_ID: ctx.project.id },
      },
      {
        // Qwik's convention: `devDependencies` are bundled into the server
        // build, `dependencies` stay external (the starter's `vite.config.ts`
        // documents this). Ecosystem packages like this one belong in
        // `devDependencies`. That config also throws when one package is
        // listed in both sections, so the writer moves an existing
        // `dependencies` entry rather than duplicating it.
        kind: "add-dep",
        name: SDK_DEPENDENCY,
        version: npmDistTagForCliVersion(ctx.cliVersion),
        dev: true,
      },
      {
        // The component library is a Qwik-ecosystem package too, so it is
        // bundled the same way.
        kind: "add-dep",
        name: COMPONENT_DEPENDENCY,
        version: npmDistTagForCliVersion(ctx.cliVersion),
        dev: true,
      },
    ];
  }

  protected routeFiles(view: PatchView): ReadonlyArray<string> {
    const src = (rel: string) => join(view.framework.appDir, rel);
    return [
      src("routes/plugin@nextgen.ts"),
      src("routes/index.tsx"),
      src("routes/login/index.tsx"),
      src("routes/register/index.tsx"),
      src("routes/profile/index.tsx"),
    ];
  }

  protected override infrastructureFiles(view: PatchView): ReadonlyArray<string> {
    // The auth boundary — proxy, session check and route protection — is
    // infrastructure: without it /__nextgen/* 404s and protected routes open, so
    // doctor fails rather than warning about a missing page.
    return [join(view.framework.appDir, "routes/plugin@nextgen.ts")];
  }

  protected routeDeps(_view: PatchView): ReadonlyArray<string> {
    return [SDK_DEPENDENCY, COMPONENT_DEPENDENCY];
  }

  protected override routeConfigEdits(_view: PatchView): ReadonlyArray<string> {
    // The dev script's port is pinned in place by an `edit` op eject can't
    // revert, so it is listed as a manual cleanup step.
    return ["package.json"];
  }

  protected summary(_ctx: PatchContext): { title: string; detail: string } {
    return {
      title: "Qwik City integration",
      detail:
        "Wrote src/routes/plugin@nextgen.ts (@zitadel/sdk-qwik-city onRequest) plus landing/login/register/profile routes using @zitadel/sdk-qwik.",
    };
  }
}
