import { join } from "node:path";

import { sdkVersionForCli } from "../../../../public-cli";
import type { FileOp } from "../file-writer/types";
import type { PatchContext, PatchView } from "../../types";
import { AbstractRulePatcher } from "../base";
import { devScriptPortOp } from "../dev-script-port";
import { envVarsEdit } from "./env-vars";
import {
  hooksServerTemplate,
  indexPageTemplate,
  layoutTemplate,
  loginPageTemplate,
  profilePageTemplate,
  registerPageTemplate,
} from "./templates";

const SDK_DEPENDENCY = "@zitadel/sdk-sveltekit";
/**
 * The idiomatic Svelte component library that ships the `<ZitadelLogin>` /
 * `<ZitadelSession>` Svelte components the routes render. The server SDK above is
 * plumbing only; the widget comes from here, so a SvelteKit app gets the native
 * Svelte component (typed props, callback events) rather than the bare element.
 */
const COMPONENT_DEPENDENCY = "@zitadel/sdk-svelte";

/**
 * Rule-based patcher for a SvelteKit app. Like Next.js and Nuxt, SvelteKit
 * proxies the backend and verifies the session through a server entrypoint —
 * here the `@zitadel/sdk-sveltekit` `handle` hook in `src/hooks.server.ts`.
 * Contributes the layout + landing/login/register/profile file-based routes (the
 * idiomatic `<ZitadelLogin>`/`<ZitadelSession>` Svelte components from
 * `@zitadel/sdk-svelte`), the public project-id env var, and both deps. No config
 * edit is needed — the hook is a plain file, so (like Next) every managed file
 * carries the marker.
 */
export class SvelteKitPatcher extends AbstractRulePatcher {
  canPatch(framework: string): boolean {
    return framework === "sveltekit";
  }

  protected devPortOps(ctx: PatchContext): FileOp[] {
    return [devScriptPortOp(ctx.issuer, { strictPort: true })];
  }

  protected routeOps(ctx: PatchContext): FileOp[] {
    const src = (rel: string) => join(ctx.framework.appDir, rel);
    return [
      // The auth boundary is written on every setup; a pre-existing hook at
      // this exact path is a genuine conflict the file-writer refuses (and
      // --force replaces), the same way Next writes its request boundary.
      { kind: "write", path: src("hooks.server.ts"), contents: hooksServerTemplate() },
      {
        kind: "edit",
        // SvelteKit reads every env variable an app declares from src/env.ts
        // (or .js), so the settings the hook imports from $app/env/private are
        // merged into the app's own file, and the file is written only where
        // there is none.
        path: [src("env.ts"), src("env.js")],
        edit: envVarsEdit(),
        // Undeclared, the hook cannot read its settings: doctor must fail, not pass.
        wiring: "infrastructure",
      },
      // The app shell and landing page are written only when setup created the
      // skeleton itself — a pre-existing app keeps its own root layout, theme,
      // and landing page (ADR 044), same as the Next/Nuxt homepage.
      ...(ctx.scaffoldedFramework
        ? ([
            { kind: "write", path: src("routes/+layout.svelte"), contents: layoutTemplate() },
            { kind: "write", path: src("routes/+page.svelte"), contents: indexPageTemplate() },
          ] satisfies FileOp[])
        : []),
      {
        kind: "write",
        path: src("routes/login/+page.svelte"),
        contents: loginPageTemplate(ctx),
      },
      {
        kind: "write",
        path: src("routes/register/+page.svelte"),
        contents: registerPageTemplate(ctx),
      },
      {
        kind: "write",
        path: src("routes/profile/+page.svelte"),
        contents: profilePageTemplate(),
      },
      // Pin the dev script to the origin setup registered; --strictPort makes
      // Vite exit instead of drifting to a port the project does not allow.
      devScriptPortOp(ctx.issuer, { strictPort: true }),
      { kind: "merge-env", path: ".env.example", entries: { VITE_ZITADEL_PROJECT_ID: "" } },
      {
        kind: "merge-env",
        path: ".env.local",
        entries: { VITE_ZITADEL_PROJECT_ID: ctx.project.id },
      },
      {
        kind: "add-dep",
        name: SDK_DEPENDENCY,
        version: sdkVersionForCli(ctx.cliVersion),
      },
      {
        kind: "add-dep",
        name: COMPONENT_DEPENDENCY,
        version: sdkVersionForCli(ctx.cliVersion),
      },
    ];
  }

  protected routeFiles(view: PatchView): ReadonlyArray<string> {
    const src = (rel: string) => join(view.framework.appDir, rel);
    return [
      src("hooks.server.ts"),
      src("routes/+layout.svelte"),
      src("routes/+page.svelte"),
      src("routes/login/+page.svelte"),
      src("routes/register/+page.svelte"),
      src("routes/profile/+page.svelte"),
    ];
  }

  protected override infrastructureFiles(view: PatchView): ReadonlyArray<string> {
    // The auth boundary — proxy, session check and route protection — is
    // infrastructure: without it /__nextgen/* 404s and protected routes open, so
    // doctor fails rather than warning about a missing page.
    return [join(view.framework.appDir, "hooks.server.ts")];
  }

  protected override conditionallyScaffoldedFiles(view: PatchView): ReadonlyArray<string> {
    // Written only when setup created the app skeleton itself; on a
    // pre-existing app the shell and landing page stay user-owned (see routeOps),
    // so the managed-files check must not expect them on a manifest-less app.
    const src = (rel: string) => join(view.framework.appDir, rel);
    return [src("routes/+layout.svelte"), src("routes/+page.svelte")];
  }

  protected routeDeps(_view: PatchView): ReadonlyArray<string> {
    return [SDK_DEPENDENCY, COMPONENT_DEPENDENCY];
  }

  protected override routeConfigEdits(view: PatchView): ReadonlyArray<string> {
    // The dev script's port and the env declarations are edited in place by
    // `edit` ops eject can't revert, so they are listed as manual cleanup steps.
    return ["package.json", join(view.framework.appDir, "env.*")];
  }

  protected summary(_ctx: PatchContext): { title: string; detail: string } {
    return {
      title: "SvelteKit integration",
      detail:
        "Wrote src/hooks.server.ts (@zitadel/sdk-sveltekit handle), declared its settings in src/env.ts, plus layout and landing/login/register/profile routes using @zitadel/sdk-svelte.",
    };
  }
}
