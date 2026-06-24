import { Hono } from "hono";

import type { BlobStore } from "./storage.js";

import { renderLanding, ROBOTS_TXT } from "./landing.js";
import { buildPackument } from "./packument.js";
import { SNAPSHOT_PACKAGES } from "./snapshot-manifest.js";

/**
 * Branch label that the landing page shows when running outside a
 * Vercel deploy (eg local dev). Vercel sets `VERCEL_GIT_COMMIT_REF`
 * automatically and the request handler prefers that when present.
 */
const FALLBACK_BRANCH = "local";

/**
 * Tiny indigo package-box SVG served at `/favicon.svg` and `/favicon.ico`.
 *
 * Inlined as a constant so the function bundle ships nothing extra
 * and modern browsers render the icon directly from this string.
 */
const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="#6366f1"/><path d="M3 5.5l5-2.5 5 2.5v5L8 13l-5-2.5zM3 5.5L8 8l5-2.5M8 8v5" fill="none" stroke="#fff" stroke-width="1.2" stroke-linejoin="round"/></svg>`;

/**
 * Compute the canonical origin (`scheme://host`) the registry should
 * advertise in install commands for the current request.
 *
 * Localhost connections are served over `http`; any other host is
 * assumed to be a Vercel deploy reachable over `https`.
 */
const originForHost = (hostHeader: string | undefined): string => {
  const host = hostHeader ?? "localhost";
  const scheme = host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https";
  return `${scheme}://${host}`;
};

/**
 * Resolve the git branch name displayed on the landing page. Reads
 * Vercel's injected env var when present, otherwise falls back to
 * {@link FALLBACK_BRANCH} for local dev.
 */
const branchForDeploy = (): string => process.env.VERCEL_GIT_COMMIT_REF ?? FALLBACK_BRANCH;

/**
 * Construct the Hono app that implements the npm registry protocol on
 * top of an arbitrary {@link BlobStore}.
 *
 * The same factory is used by the local Node dev server (with a
 * filesystem store rooted in the working tree) and the Vercel
 * serverless function (with a filesystem store rooted in the
 * function bundle's `.snapshots/`).
 *
 * @param store - Storage backend the routes read from.
 */
export const createApp = (store: BlobStore) => {
  const app = new Hono();

  app.get("/-/ping", (context) => context.text("OK"));

  app.get("/favicon.ico", (context) => {
    context.header("Content-Type", "image/svg+xml");
    context.header("Cache-Control", "public, max-age=86400, immutable");
    return context.body(FAVICON_SVG);
  });
  app.get("/favicon.svg", (context) => {
    context.header("Content-Type", "image/svg+xml");
    context.header("Cache-Control", "public, max-age=86400, immutable");
    return context.body(FAVICON_SVG);
  });

  // npm CLI pings these endpoints during install to check for known
  // vulnerabilities. An empty JSON object means "no advisories" — we
  // host throwaway snapshot packages and have nothing meaningful to
  // report, but returning 404 makes npm log a confusing warning.
  app.post("/-/npm/v1/security/audits/quick", (context) => context.json({}));
  app.post("/-/npm/v1/security/advisories/bulk", (context) => context.json({}));

  app.get("/robots.txt", (context) => {
    context.header("Content-Type", "text/plain; charset=utf-8");
    return context.body(ROBOTS_TXT);
  });

  // Note: '/' is served as a STATIC file from apps/preview-registry/public/
  // (written by scripts/publish-on-deploy.ts), so this Hono route is only
  // reached during local dev where there is no static serving layer.
  app.get("/", (context) => {
    const origin = originForHost(context.req.header("host"));
    return context.html(renderLanding(SNAPSHOT_PACKAGES, origin, branchForDeploy()));
  });

  app.get("/-/blob/*", async (context) => {
    const key = decodeURIComponent(context.req.path.replace(/^\/-\/blob\//, ""));
    try {
      const tarball = await store.read(key);
      const copy = new Uint8Array(tarball.byteLength);
      copy.set(tarball);
      context.header("Content-Type", "application/octet-stream");
      return context.body(copy);
    } catch {
      return context.json({ error: "not found" }, 404);
    }
  });

  app.get("/:scope{@[^/]+}/:name", async (context) => {
    const packument = await buildPackument(
      store,
      context.req.param("scope"),
      context.req.param("name"),
    );
    if (!packument) return context.json({ error: "not found" }, 404);
    context.header("Cache-Control", "s-maxage=60, stale-while-revalidate=86400");
    return context.json(packument);
  });

  app.get("/:full{@[^/]+%2[Ff][^/]+}", async (context) => {
    const decoded = decodeURIComponent(context.req.param("full"));
    const [scope, name] = decoded.split("/");
    if (!scope || !name) return context.json({ error: "bad path" }, 400);
    const packument = await buildPackument(store, scope, name);
    if (!packument) return context.json({ error: "not found" }, 404);
    context.header("Cache-Control", "s-maxage=60, stale-while-revalidate=86400");
    return context.json(packument);
  });

  app.notFound((context) => context.json({ error: "not found", path: context.req.path }, 404));
  app.onError((error, context) =>
    context.json(
      {
        error: error.message,
        path: context.req.path,
        stack: error.stack,
      },
      500,
    ),
  );

  return app;
};
