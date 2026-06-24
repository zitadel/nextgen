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
 * The scheme comes from the `x-forwarded-proto` header when present —
 * Vercel and most reverse proxies set it, so production deploys
 * correctly advertise `https`. Without that header the request reached
 * the Node server directly (local dev, including via a LAN IP or dev
 * proxy hostname), so we default to `http` rather than guessing `https`
 * from the host and printing an unreachable registry URL.
 */
const originForHost = (
  hostHeader: string | undefined,
  forwardedProto: string | undefined,
): string => {
  const host = hostHeader ?? "localhost";
  const scheme = forwardedProto?.split(",")[0]?.trim() || "http";
  return `${scheme}://${host}`;
};

/**
 * Resolve the git branch name displayed on the landing page. Reads
 * Vercel's injected env var when present, otherwise falls back to
 * {@link FALLBACK_BRANCH} for local dev.
 */
const branchForDeploy = (): string => process.env.VERCEL_GIT_COMMIT_REF ?? FALLBACK_BRANCH;

/**
 * Reject blob keys that could escape the snapshot storage root.
 *
 * A legitimate tarball key is always a relative `@scope/name/-/file.tgz`
 * path. An empty key, an absolute path, a Windows drive prefix, or any
 * `..` traversal segment indicates an attempt to read outside
 * `.snapshots` (eg the function bundle itself) and is refused before
 * the key ever reaches the filesystem store.
 */
const isSafeBlobKey = (key: string): boolean => {
  if (key.length === 0) return false;
  if (key.startsWith("/") || key.startsWith("\\")) return false;
  if (/^[a-zA-Z]:/.test(key)) return false;
  return !key.split(/[/\\]/).includes("..");
};

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
    const origin = originForHost(
      context.req.header("host"),
      context.req.header("x-forwarded-proto"),
    );
    return context.html(renderLanding(SNAPSHOT_PACKAGES, origin, branchForDeploy()));
  });

  app.get("/-/blob/*", async (context) => {
    // decodeURIComponent throws on malformed percent-encoding (eg
    // `%E0%A4%A`); treat that as a miss rather than letting it bubble to
    // the 500 handler.
    let key: string;
    try {
      key = decodeURIComponent(context.req.path.replace(/^\/-\/blob\//, ""));
    } catch {
      return context.json({ error: "not found" }, 404);
    }
    if (!isSafeBlobKey(key)) {
      return context.json({ error: "not found" }, 404);
    }
    try {
      const tarball = await store.read(key);
      // Return the Buffer directly as the Response body — it's already a
      // valid BodyInit, so there's no extra O(n) copy per download.
      // Snapshot tarballs are immutable (each is bundled into one deploy
      // under a commit-stamped name), so cache them aggressively at both
      // the client and the CDN to avoid re-downloads across install
      // retries.
      return new Response(tarball, {
        headers: {
          "Content-Type": "application/octet-stream",
          "Cache-Control": "public, max-age=31536000, s-maxage=31536000, immutable",
        },
      });
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
    // Malformed percent-encoding makes decodeURIComponent throw; surface
    // it as a 400 bad path instead of a 500.
    let decoded: string;
    try {
      decoded = decodeURIComponent(context.req.param("full"));
    } catch {
      return context.json({ error: "bad path" }, 400);
    }
    // Require exactly `<scope>/<name>` — a decoded value with extra
    // segments (eg `@scope/name/extra`) would otherwise silently resolve
    // to a different package than the URL implies.
    const segments = decoded.split("/");
    const [scope, name] = segments;
    if (segments.length !== 2 || !scope || !name) {
      return context.json({ error: "bad path" }, 400);
    }
    const packument = await buildPackument(store, scope, name);
    if (!packument) return context.json({ error: "not found" }, 404);
    context.header("Cache-Control", "s-maxage=60, stale-while-revalidate=86400");
    return context.json(packument);
  });

  app.notFound((context) => context.json({ error: "not found", path: context.req.path }, 404));
  app.onError((error, context) => {
    // Stack traces can expose internal file paths and source snippets.
    // Preview deploys are public (Deployment Protection is disabled so
    // the npm CLI can reach them), so only attach a stack in genuine
    // local dev — i.e. when not running on Vercel at all. Vercel sets
    // the `VERCEL` env var on every build and deployment.
    const includeStack = !process.env.VERCEL;
    return context.json(
      {
        error: error.message,
        path: context.req.path,
        ...(includeStack ? { stack: error.stack } : {}),
      },
      500,
    );
  });

  return app;
};
