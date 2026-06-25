import type { BlobEntry } from "./storage.js";

/**
 * One row on the landing page's package list.
 *
 * Snapshot version is parsed out of the tarball filename rather than
 * read from the manifest inside, so producing this list is a cheap
 * pure-data transform with no I/O.
 */
export interface PackageRow {
  readonly name: string;
  readonly version: string;
  readonly sizeBytes: number;
}

/** Character-to-entity table used by {@link escapeHtml}. */
const HTML_ESCAPE_MAP = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
} as const;

/** Regex matching any character that requires HTML entity encoding. */
const HTML_ESCAPE_PATTERN = /[&<>"']/g;

/** Encode `&`, `<`, `>`, `"`, `'` as HTML entities so user-supplied strings cannot break the document. */
const escapeHtml = (input: string): string =>
  input.replace(
    HTML_ESCAPE_PATTERN,
    (character) => HTML_ESCAPE_MAP[character as keyof typeof HTML_ESCAPE_MAP] ?? character,
  );

/**
 * Regex matching a snapshot tarball blob key. Captures the npm package
 * name in group 1 and the tarball filename (without `.tgz`) in group 2.
 */
const TARBALL_KEY_PATTERN = /^(@[^/]+\/[^/]+)\/-\/(.+)\.tgz$/;

/**
 * Derive a sorted, deduplicated list of {@link PackageRow}s from the
 * raw blob listing.
 *
 * Each tarball's blob key looks like
 * `@scope/name/-/scope-name-<version>.tgz`. The scope and name come
 * from the directory portion; the version is recovered by stripping
 * the `scope-name-` prefix from the filename. Blobs that do not match
 * this shape are silently skipped — the registry happily ignores
 * anything else dropped into its storage root.
 */
export const collectPackages = (blobs: readonly BlobEntry[]): readonly PackageRow[] => {
  const rowsByName = blobs.reduce<ReadonlyMap<string, PackageRow>>((accumulator, blob) => {
    const match = blob.key.match(TARBALL_KEY_PATTERN);
    if (!match) return accumulator;
    const [, packageName, filename] = match;
    if (!packageName || !filename) return accumulator;
    if (accumulator.has(packageName)) return accumulator;
    const filenamePrefix = packageName.replace("@", "").replace("/", "-") + "-";
    const version = filename.startsWith(filenamePrefix)
      ? filename.slice(filenamePrefix.length)
      : "unknown";
    return new Map([
      ...accumulator,
      [packageName, { name: packageName, version, sizeBytes: blob.size }],
    ]);
  }, new Map());

  return [...rowsByName.values()].sort((left, right) => left.name.localeCompare(right.name));
};

/**
 * Render a minimal HTML landing page describing this deploy.
 *
 * Auto-adapts to the visitor's `prefers-color-scheme` (no toggle), is
 * intentionally `noindex/nofollow` so preview deploys never get
 * crawled, and styles itself with Tailwind via CDN so the function
 * bundle ships nothing but the inlined HTML string.
 *
 * @param packages - Sorted package list from {@link collectPackages}.
 * @param origin - Absolute URL prefix to advertise install commands
 *   against (`https://<deploy>.vercel.app`).
 * @param branch - Git branch name this deploy was built from. Used
 *   purely for display.
 */
export const renderLanding = (
  packages: readonly PackageRow[],
  origin: string,
  branch: string,
): string => {
  const firstPackage = packages[0];
  const scope = firstPackage?.name.split("/")[0];

  const installBlock = firstPackage
    ? `
    <section class="mb-10">
      <h2 class="mb-2 text-sm font-medium">Option 1 — one-off install</h2>
      <p class="mb-2 text-sm text-slate-500 dark:text-slate-400">
        Point only the <code>${escapeHtml(scope ?? "")}</code> scope at this
        registry so third-party dependencies still resolve from the default
        registry. No version needed — <code>latest</code> resolves to this
        deploy's snapshot.
      </p>
      <pre class="overflow-x-auto rounded border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-800 dark:bg-slate-900">npm install ${escapeHtml(firstPackage.name)} --${escapeHtml(scope ?? "")}:registry=${escapeHtml(origin)}</pre>
    </section>

    <section class="mb-10">
      <h2 class="mb-2 text-sm font-medium">Option 2 — pin the <code>${escapeHtml(scope ?? "")}</code> scope</h2>
      <p class="mb-2 text-sm text-slate-500 dark:text-slate-400">
        Add one line to your <code>.npmrc</code>, then install any package below normally:
      </p>
      <pre class="overflow-x-auto rounded border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-800 dark:bg-slate-900">${escapeHtml(scope ?? "")}:registry=${escapeHtml(origin)}</pre>
      <pre class="mt-2 overflow-x-auto rounded border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-800 dark:bg-slate-900">npm install ${escapeHtml(firstPackage.name)}</pre>
    </section>

    <section class="mb-10">
      <h2 class="mb-2 text-sm font-medium">Pin an exact build (optional)</h2>
      <p class="mb-2 text-sm text-slate-500 dark:text-slate-400">
        Each snapshot is tagged with its commit, so you can pin a reproducible version:
      </p>
      <pre class="overflow-x-auto rounded border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-800 dark:bg-slate-900">npm install ${escapeHtml(firstPackage.name)}@${escapeHtml(firstPackage.version)} --${escapeHtml(scope ?? "")}:registry=${escapeHtml(origin)}</pre>
    </section>
    `
    : "";

  const packageListHtml =
    packages.length > 0
      ? packages
          .map(
            (entry) => `
        <li class="flex items-baseline justify-between border-b border-slate-200 py-2 dark:border-slate-800">
          <code class="text-sm">${escapeHtml(entry.name)}</code>
          <span class="text-xs text-slate-500 dark:text-slate-400">${escapeHtml(entry.version)}</span>
        </li>`,
          )
          .join("")
      : `<li class="py-2 text-sm text-slate-500 dark:text-slate-400">No snapshots in this deploy yet.</li>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive, nosnippet, noimageindex">
<meta name="googlebot" content="noindex, nofollow, noarchive">
<meta name="referrer" content="no-referrer">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<title>per-PR npm registry · ${escapeHtml(branch)}</title>
<script src="https://cdn.tailwindcss.com"></script>
<style>
  html { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
  pre, code { font-family: ui-monospace, 'SF Mono', Menlo, monospace; }
</style>
</head>
<body class="bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
  <main class="mx-auto max-w-2xl px-6 py-16">
    <header class="mb-10">
      <h1 class="text-xl font-semibold tracking-tight">per-PR npm registry</h1>
      <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Branch <code>${escapeHtml(branch)}</code>
      </p>
    </header>

${installBlock}

    <section class="mb-10">
      <h2 class="mb-2 text-sm font-medium">Packages in this deploy</h2>
      <ul>${packageListHtml}
      </ul>
    </section>

    <footer class="mt-16 border-t border-slate-200 pt-6 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
      Every git push redeploys this URL with fresh tarballs bundled inside the function.
    </footer>
  </main>
</body>
</html>`;
};

/**
 * Plain-text body served at `/robots.txt` to keep crawlers out of any
 * preview deploy URL.
 */
export const ROBOTS_TXT = `User-agent: *
Disallow: /
`;
