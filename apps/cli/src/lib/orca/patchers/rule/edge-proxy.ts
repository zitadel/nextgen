import { MANAGED_MARKER } from "../../../paths";
import { npmDistTagForCliVersion } from "../../../public-cli";
import type { DeployTarget } from "../../detectors/deploy-target";
import type { PatchContext } from "../types";
import type { FileOp } from "./file-writer/types";
import { PROXY_PATH } from "./proxy";

/**
 * Production edge-proxy scaffolding shared by every SPA framework (React, Vue,
 * Solid, Svelte, Qwik, Angular). A SPA has no server runtime, so the
 * same-origin `/__nextgen/*` proxy that injects the project service-key must run
 * as a platform edge function/worker. The dev proxy each framework already
 * scaffolds (Vite proxy, Angular's `proxy.conf.cjs`) covers local development;
 * this covers production by writing the platform's edge entry, wiring the
 * `@zitadel/edge-proxy` handler, and recording the backend URL.
 *
 * All three platforms intercept `/__nextgen/*` directly (Cloudflare
 * `run_worker_first`, Netlify edge-function `path`, Vercel Edge Middleware
 * `matcher`), so the handler's default `pathPrefix` matches without an extra
 * rewrite hop. The secret is read from a server-side env var inside the edge
 * runtime and never reaches the browser.
 */

/** The npm package the scaffolded edge entry imports. */
export const EDGE_PROXY_DEP = "@zitadel/edge-proxy";

/**
 * Framework ids that get a production edge proxy: the SPAs with no server
 * runtime. SSR/meta-frameworks (next, nuxt) run the proxy in their own
 * middleware and are intentionally excluded.
 */
const EDGE_PROXY_FRAMEWORKS: ReadonlySet<string> = new Set([
  "react",
  "vue",
  "solid",
  "svelte",
  "qwik",
  "angular",
]);

/** Whether `framework` is an SPA that needs a production edge proxy. */
export function isEdgeProxyFramework(framework: string): boolean {
  return EDGE_PROXY_FRAMEWORKS.has(framework);
}

const CLOUDFLARE_WORKER_PATH = "zitadel-edge-proxy.ts";
const VERCEL_MIDDLEWARE_PATH = "middleware.ts";
const NETLIFY_FUNCTION_PATH = "netlify/edge-functions/zitadel-nextgen.ts";

function cloudflareWorker(): string {
  return `${MANAGED_MARKER}
import { handleProxy, resolveConfig } from "${EDGE_PROXY_DEP}";

interface Env {
  NEXTGEN_API_URL: string;
  ZITADEL_PROJECT_SECRET: string;
  ASSETS: Fetcher;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const config = resolveConfig({
      apiUrl: env.NEXTGEN_API_URL,
      projectSecret: env.ZITADEL_PROJECT_SECRET,
    });
    return (await handleProxy(req, config)) ?? env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
`;
}

function vercelMiddleware(): string {
  return `${MANAGED_MARKER}
import { handleProxy, resolveConfig } from "${EDGE_PROXY_DEP}";

export const config = { matcher: ["${PROXY_PATH}", "${PROXY_PATH}/:path*"] };

const proxyConfig = resolveConfig({
  apiUrl: process.env.NEXTGEN_API_URL ?? "",
  projectSecret: process.env.ZITADEL_PROJECT_SECRET ?? "",
});

export default async function middleware(req: Request): Promise<Response | undefined> {
  return (await handleProxy(req, proxyConfig)) ?? undefined;
}
`;
}

function netlifyFunction(): string {
  return `${MANAGED_MARKER}
import { handleProxy, resolveConfig } from "${EDGE_PROXY_DEP}";
import type { Config } from "@netlify/edge-functions";

export default (req: Request): Promise<Response | null> =>
  handleProxy(
    req,
    resolveConfig({
      apiUrl: Netlify.env.get("NEXTGEN_API_URL") ?? "",
      projectSecret: Netlify.env.get("ZITADEL_PROJECT_SECRET") ?? "",
    }),
  );

export const config: Config = { path: "${PROXY_PATH}/*" };
`;
}

/** Candidate Cloudflare config filenames, in resolution priority. */
const WRANGLER_CONFIG_PATHS = ["wrangler.jsonc", "wrangler.toml", "wrangler.json"];

function wranglerConfig(server: string): string {
  // A JSONC template (not JSON.stringify) so the placeholder values carry
  // inline guidance — the project name and asset directory are framework- and
  // user-specific and must be reviewed.
  return `{
  "$schema": "https://raw.githubusercontent.com/cloudflare/workers-sdk/main/packages/wrangler/config-schema.json",
  // Replace "my-app" with your project name.
  "name": "my-app",
  // 2025-01-01 or later is required for Headers.getSetCookie() support.
  "compatibility_date": "2025-01-01",
  "main": "./${CLOUDFLARE_WORKER_PATH}",
  "assets": {
    // Point this at your SPA build output (e.g. Angular: dist/<project>/browser).
    "directory": "./dist",
    // Required when "main" is set: exposes the static assets to the Worker as
    // env.ASSETS. Without it the Worker's fallback throws on every page request.
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    // Run the Worker first for all /__nextgen/* requests.
    "run_worker_first": ["${PROXY_PATH}/*"]
  },
  "vars": {
    "NEXTGEN_API_URL": ${JSON.stringify(server)}
  }
}
`;
}

/**
 * Creates `wrangler.jsonc` only when no Cloudflare config exists yet. The edit
 * op is given every wrangler config candidate (`.jsonc`/`.toml`/`.json`), so if
 * the user already has one it is edited in place — and this transform returns it
 * untouched, never clobbering a hand-tuned worker config. Only when none exist
 * does the executor fall back to creating the first candidate (`wrangler.jsonc`).
 */
function wranglerEdit(server: string): (source: string | undefined) => string {
  return (source) => (source === undefined ? wranglerConfig(server) : source);
}

/**
 * The file operations that scaffold the production edge proxy for `target`.
 * Spread into an SPA patcher's `routeOps` when a deploy target was detected.
 */
export function edgeProxyOps(target: DeployTarget, ctx: PatchContext): FileOp[] {
  const dep: FileOp = {
    kind: "add-dep",
    name: EDGE_PROXY_DEP,
    version: npmDistTagForCliVersion(ctx.cliVersion),
  };
  const apiUrlExample: FileOp = {
    kind: "merge-env",
    path: ".env.example",
    entries: { NEXTGEN_API_URL: "" },
  };

  switch (target) {
    case "cloudflare":
      return [
        dep,
        // The worker's `Fetcher`/`ExportedHandler` types come from this package;
        // `wrangler deploy` typechecks the worker, so it must be installed.
        { kind: "add-dep", name: "@cloudflare/workers-types", version: "^4.0.0", dev: true },
        { kind: "write", path: CLOUDFLARE_WORKER_PATH, contents: cloudflareWorker() },
        // Given every wrangler config candidate so an existing .toml/.json is
        // edited (and left untouched) rather than shadowed by a new .jsonc.
        { kind: "edit", path: [...WRANGLER_CONFIG_PATHS], edit: wranglerEdit(ctx.server) },
        // wrangler dev reads .dev.vars (not .env.local); it carries the secret
        // locally and must stay out of git.
        {
          kind: "merge-env",
          path: ".dev.vars",
          entries: {
            NEXTGEN_API_URL: ctx.server,
            ZITADEL_PROJECT_SECRET: ctx.project.projectSecret,
          },
        },
        { kind: "append-gitignore", entries: [".dev.vars"] },
        apiUrlExample,
      ];
    case "vercel":
      return [
        dep,
        { kind: "write", path: VERCEL_MIDDLEWARE_PATH, contents: vercelMiddleware() },
        // vercel dev reads .env.local; the secret is already written there by
        // the base patcher, so only the backend URL needs adding.
        { kind: "merge-env", path: ".env.local", entries: { NEXTGEN_API_URL: ctx.server } },
        apiUrlExample,
      ];
    case "netlify":
      return [
        dep,
        // The edge function imports the `Config` type and `Netlify` global from
        // this package; install it so the scaffolded function typechecks.
        { kind: "add-dep", name: "@netlify/edge-functions", version: "^2.0.0", dev: true },
        // Functions in netlify/edge-functions/ are auto-discovered and routed by
        // the inline `config.path`, so no netlify.toml entry is needed (which
        // also avoids hardcoding a wrong publish dir for Angular et al.).
        { kind: "write", path: NETLIFY_FUNCTION_PATH, contents: netlifyFunction() },
        // `netlify dev` loads .env (not .env.local), and edge functions only see
        // env injected by the platform — so write both vars where dev picks them
        // up. .env is gitignored, so the secret stays out of git.
        {
          kind: "merge-env",
          path: ".env",
          entries: {
            NEXTGEN_API_URL: ctx.server,
            ZITADEL_PROJECT_SECRET: ctx.project.projectSecret,
          },
        },
        apiUrlExample,
      ];
  }
}

/** Managed (marker-bearing) edge-proxy files for `target`, for ejection. */
export function edgeProxyFiles(target: DeployTarget): string[] {
  switch (target) {
    case "cloudflare":
      return [CLOUDFLARE_WORKER_PATH];
    case "vercel":
      return [VERCEL_MIDDLEWARE_PATH];
    case "netlify":
      return [NETLIFY_FUNCTION_PATH];
  }
}

/** Config files the edge-proxy scaffolding edits in place, for ejection. */
export function edgeProxyConfigEdits(target: DeployTarget): string[] {
  // Cloudflare may create wrangler.jsonc; Vercel uses a managed middleware file
  // (a marked file, not a config edit); Netlify auto-discovers the edge function
  // with no config file to edit.
  return target === "cloudflare" ? ["wrangler.jsonc"] : [];
}

/**
 * Env files the edge-proxy scaffolding writes a secret into, for ejection.
 * Cloudflare gets `.dev.vars` (what `wrangler dev` reads); Netlify gets `.env`
 * (what `netlify dev` reads); Vercel reuses `.env.local`, which the base patcher
 * already backs up, so it contributes nothing here.
 */
export function edgeProxyEnvBackups(target: DeployTarget): string[] {
  switch (target) {
    case "cloudflare":
      return [".dev.vars"];
    case "netlify":
      return [".env"];
    case "vercel":
      return [];
  }
}

/**
 * Extra deploy guidance surfaced in the setup summary. Cloudflare needs a note
 * because, when the project already has a wrangler config, the scaffolder leaves
 * it untouched — so the worker is written but not wired, and the user must add
 * the keys themselves.
 */
export function edgeProxyDeployNotes(target: DeployTarget): string[] {
  if (target === "cloudflare") {
    return [
      `If you already have a wrangler config, wire the worker into it: ` +
        `main "./${CLOUDFLARE_WORKER_PATH}", assets.binding "ASSETS", and ` +
        `run_worker_first ["${PROXY_PATH}/*"].`,
    ];
  }
  return [];
}

/**
 * The commands a user runs to put the project secret into the platform's secret
 * store for production (it must not live in a committed config file). Surfaced
 * in the setup summary.
 */
export function edgeProxySecretCommands(target: DeployTarget): string[] {
  switch (target) {
    case "cloudflare":
      // NEXTGEN_API_URL is a plaintext `var` in wrangler.jsonc; only the secret
      // goes to the encrypted secret store.
      return ["wrangler secret put ZITADEL_PROJECT_SECRET"];
    case "vercel":
      return ["vercel env add ZITADEL_PROJECT_SECRET", "vercel env add NEXTGEN_API_URL"];
    case "netlify":
      return [
        "netlify env:set ZITADEL_PROJECT_SECRET <secret>",
        "netlify env:set NEXTGEN_API_URL <backend-url>",
      ];
  }
}
