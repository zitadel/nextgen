/** The deployment prefix from the Vite `base`: `/ui/console` when embedded, empty in dev. */
export function basePath(): string {
  return import.meta.env.BASE_URL.replace(/\/$/, "");
}

/** A router-relative path as a document URL, for full-page navigations. */
export function withBasePath(path: string): string {
  return `${basePath()}${path}`;
}

/**
 * A raw history href as a router-relative path: the deployment prefix is
 * stripped so the router and the login screen's `postSignInUrl` (which re-joins
 * it) agree. The root is the default target and comes back as `undefined`.
 */
export function routerRelativeHref(href: string): string | undefined {
  const base = basePath();
  const relative = base && href.startsWith(base) ? href.slice(base.length) : href;
  const normalized = relative.startsWith("/") ? relative : `/${relative}`;
  return normalized === "/" ? undefined : normalized;
}
