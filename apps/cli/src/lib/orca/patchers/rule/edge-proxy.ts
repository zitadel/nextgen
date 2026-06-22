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

/** Marker line the Netlify-toml edit keys off for idempotency. */
const NETLIFY_FUNCTION_NAME = "zitadel-nextgen";

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

export const config = { matcher: ["${PROXY_PATH}/:path*"] };

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

function wranglerConfig(server: string): string {
  return `${JSON.stringify(
    {
      $schema:
        "https://raw.githubusercontent.com/cloudflare/workers-sdk/main/packages/wrangler/config-schema.json",
      name: "my-app",
      compatibility_date: "2025-01-01",
      main: `./${CLOUDFLARE_WORKER_PATH}`,
      assets: {
        directory: "./dist",
        not_found_handling: "single-page-application",
        run_worker_first: [`${PROXY_PATH}/*`],
      },
      vars: { NEXTGEN_API_URL: server },
    },
    null,
    2,
  )}\n`;
}

/**
 * Creates `wrangler.jsonc` when absent; leaves an existing Cloudflare config
 * untouched so a user's hand-tuned worker config is never clobbered (the setup
 * summary prints the keys to add manually in that case).
 */
function wranglerEdit(server: string): (source: string | undefined) => string {
  return (source) => (source === undefined ? wranglerConfig(server) : source);
}

const NETLIFY_BLOCK = `\n[[edge_functions]]\n  function = "${NETLIFY_FUNCTION_NAME}"\n  path = "${PROXY_PATH}/*"\n`;

/**
 * Appends the `[[edge_functions]]` block to `netlify.toml` (creating the file
 * with a `[build]` publish dir when absent). Idempotent: keyed off the function
 * name, so a second run leaves the file unchanged.
 */
function netlifyTomlEdit(): (source: string | undefined) => string {
  return (source) => {
    if (source === undefined) {
      return `[build]\n  publish = "dist"\n${NETLIFY_BLOCK}`;
    }
    if (source.includes(`function = "${NETLIFY_FUNCTION_NAME}"`)) {
      return source;
    }
    return source.endsWith("\n") ? `${source}${NETLIFY_BLOCK}` : `${source}\n${NETLIFY_BLOCK}`;
  };
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
        { kind: "write", path: CLOUDFLARE_WORKER_PATH, contents: cloudflareWorker() },
        { kind: "edit", path: "wrangler.jsonc", edit: wranglerEdit(ctx.server) },
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
        { kind: "write", path: NETLIFY_FUNCTION_PATH, contents: netlifyFunction() },
        { kind: "edit", path: "netlify.toml", edit: netlifyTomlEdit() },
        { kind: "merge-env", path: ".env.local", entries: { NEXTGEN_API_URL: ctx.server } },
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
  switch (target) {
    case "cloudflare":
      return ["wrangler.jsonc"];
    case "vercel":
      return [];
    case "netlify":
      return ["netlify.toml"];
  }
}

/**
 * The commands a user runs to put the project secret into the platform's secret
 * store for production (it must not live in a committed config file). Surfaced
 * in the setup summary.
 */
export function edgeProxySecretCommands(target: DeployTarget): string[] {
  switch (target) {
    case "cloudflare":
      return ["wrangler secret put ZITADEL_PROJECT_SECRET", "wrangler secret put NEXTGEN_API_URL"];
    case "vercel":
      return ["vercel env add ZITADEL_PROJECT_SECRET", "vercel env add NEXTGEN_API_URL"];
    case "netlify":
      return [
        "netlify env:set ZITADEL_PROJECT_SECRET <secret>",
        "netlify env:set NEXTGEN_API_URL <backend-url>",
      ];
  }
}
