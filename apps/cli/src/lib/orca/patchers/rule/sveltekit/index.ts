import { join } from "node:path";

import { npmDistTagForCliVersion } from "../../../../public-cli";
import type { FileOp } from "../file-writer/types";
import type { PatchContext, PatchView } from "../../types";
import { AbstractRulePatcher } from "../base";
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
 * `<ZitadelLogout>` Svelte components the routes render. The server SDK above is
 * plumbing only; the widget comes from here, so a SvelteKit app gets the native
 * Svelte component (typed props, callback events) rather than the bare element.
 */
const COMPONENT_DEPENDENCY = "@zitadel/sdk-svelte";

/**
 * Rule-based patcher for a SvelteKit app. Like Next.js and Nuxt, SvelteKit
 * proxies the backend and verifies the session through a server entrypoint —
 * here the `@zitadel/sdk-sveltekit` `handle` hook in `src/hooks.server.ts`.
 * Contributes the layout + landing/login/register/profile file-based routes (the
 * idiomatic `<ZitadelLogin>`/`<ZitadelLogout>` Svelte components from
 * `@zitadel/sdk-svelte`), the public project-id env var, and both deps. No config
 * edit is needed — the hook is a plain file, so (like Next) every managed file
 * carries the marker.
 */
export class SvelteKitPatcher extends AbstractRulePatcher {
  canPatch(framework: string): boolean {
    return framework === "sveltekit";
  }

  protected routeOps(ctx: PatchContext): FileOp[] {
    const src = (rel: string) => join(ctx.framework.appDir, rel);
    return [
      { kind: "write", path: src("hooks.server.ts"), contents: hooksServerTemplate() },
      { kind: "write", path: src("routes/+layout.svelte"), contents: layoutTemplate() },
      { kind: "write", path: src("routes/+page.svelte"), contents: indexPageTemplate() },
      { kind: "write", path: src("routes/login/+page.svelte"), contents: loginPageTemplate() },
      {
        kind: "write",
        path: src("routes/register/+page.svelte"),
        contents: registerPageTemplate(),
      },
      { kind: "write", path: src("routes/profile/+page.svelte"), contents: profilePageTemplate() },
      { kind: "merge-env", path: ".env.example", entries: { PUBLIC_ZITADEL_PROJECT_ID: "" } },
      {
        kind: "merge-env",
        path: ".env.local",
        entries: { PUBLIC_ZITADEL_PROJECT_ID: ctx.project.id },
      },
      {
        kind: "add-dep",
        name: SDK_DEPENDENCY,
        version: npmDistTagForCliVersion(ctx.cliVersion),
      },
      {
        kind: "add-dep",
        name: COMPONENT_DEPENDENCY,
        version: npmDistTagForCliVersion(ctx.cliVersion),
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

  protected routeDeps(_view: PatchView): ReadonlyArray<string> {
    return [SDK_DEPENDENCY, COMPONENT_DEPENDENCY];
  }

  protected summary(_ctx: PatchContext): { title: string; detail: string } {
    return {
      title: "SvelteKit integration",
      detail:
        "Wrote src/hooks.server.ts (@zitadel/sdk-sveltekit handle) plus layout and landing/login/register/profile routes using @zitadel/sdk-svelte.",
    };
  }
}
