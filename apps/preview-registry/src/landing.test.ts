import { describe, expect, test } from "vitest";

import type { BlobEntry } from "./storage.js";

import { collectPackages, renderLanding, ROBOTS_TXT, type PackageRow } from "./landing.js";

const blob = (overrides: Partial<BlobEntry>): BlobEntry => ({
  key: "@foodbar/alpha/-/foodbar-alpha-0.0.0-sha-abc1234.tgz",
  url: "https://example.test/-/blob/alpha",
  size: 1024,
  uploadedAt: new Date("2026-06-24T00:00:00Z"),
  ...overrides,
});

describe("collectPackages", () => {
  test("parses scope, name, version, and size from each tarball blob", () => {
    const rows = collectPackages([
      blob({
        key: "@foodbar/alpha/-/foodbar-alpha-0.0.0-sha-abc1234.tgz",
        size: 708,
      }),
    ]);
    expect(rows).toEqual<readonly PackageRow[]>([
      { name: "@foodbar/alpha", version: "0.0.0-sha-abc1234", sizeBytes: 708 },
    ]);
  });

  test("sorts the result alphabetically by package name", () => {
    const rows = collectPackages([
      blob({ key: "@foodbar/zulu/-/foodbar-zulu-0.0.0-sha-x.tgz" }),
      blob({ key: "@foodbar/alpha/-/foodbar-alpha-0.0.0-sha-x.tgz" }),
      blob({ key: "@foodbar/mike/-/foodbar-mike-0.0.0-sha-x.tgz" }),
    ]);
    expect(rows.map((row) => row.name)).toEqual([
      "@foodbar/alpha",
      "@foodbar/mike",
      "@foodbar/zulu",
    ]);
  });

  test("deduplicates by package name (first blob wins)", () => {
    const rows = collectPackages([
      blob({
        key: "@foodbar/alpha/-/foodbar-alpha-0.0.0-sha-aaaaaaa.tgz",
        size: 100,
      }),
      blob({
        key: "@foodbar/alpha/-/foodbar-alpha-0.0.0-sha-bbbbbbb.tgz",
        size: 200,
      }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.version).toBe("0.0.0-sha-aaaaaaa");
  });

  test("ignores blobs that do not match the expected tarball shape", () => {
    const rows = collectPackages([
      blob({ key: "not-a-package.txt" }),
      blob({ key: "@foodbar/alpha/-/garbage" }),
      blob({ key: "@foodbar/alpha/-/foodbar-alpha-0.0.0-sha-ok.tgz" }),
    ]);
    expect(rows.map((row) => row.name)).toEqual(["@foodbar/alpha"]);
  });

  test("returns an empty list when no blobs match", () => {
    expect(collectPackages([])).toEqual([]);
  });

  test('falls back to "unknown" when the filename does not carry a version', () => {
    const rows = collectPackages([blob({ key: "@foodbar/alpha/-/totally-unrelated.tgz" })]);
    expect(rows[0]?.version).toBe("unknown");
  });
});

describe("renderLanding", () => {
  const samplePackages: readonly PackageRow[] = [
    { name: "@foodbar/alpha", version: "0.0.0-sha-abc", sizeBytes: 800 },
    { name: "@foodbar/bravo", version: "0.0.0-sha-abc", sizeBytes: 1024 },
  ];

  test("embeds the deploy origin and branch into the HTML output", () => {
    const html = renderLanding(samplePackages, "https://my-deploy.vercel.app", "feat/example");
    expect(html).toContain("https://my-deploy.vercel.app");
    expect(html).toContain("feat/example");
  });

  test("emits noindex / nofollow robot directives", () => {
    const html = renderLanding(samplePackages, "https://my-deploy.vercel.app", "main");
    expect(html).toMatch(/<meta name="robots"[^>]*noindex/i);
    expect(html).toMatch(/<meta name="robots"[^>]*nofollow/i);
    expect(html).toMatch(/<meta name="googlebot"[^>]*noindex/i);
  });

  test("lists every package by name and version", () => {
    const html = renderLanding(samplePackages, "https://my-deploy.vercel.app", "main");
    expect(html).toContain("@foodbar/alpha");
    expect(html).toContain("@foodbar/bravo");
    expect(html).toContain("0.0.0-sha-abc");
  });

  test("shows install command for a single example package, not all of them", () => {
    const html = renderLanding(samplePackages, "https://x.test", "main");
    expect(html).toContain("npm install @foodbar/alpha@0.0.0-sha-abc --registry=https://x.test");
    expect(html).not.toContain("npm install @foodbar/alpha@0.0.0-sha-abc @foodbar/bravo");
  });

  test("derives the scope for the .npmrc snippet from the first package", () => {
    const html = renderLanding(samplePackages, "https://x.test", "main");
    expect(html).toContain("@foodbar:registry=https://x.test");
  });

  test("omits the install section entirely when no packages are bundled", () => {
    const html = renderLanding([], "https://x.test", "main");
    expect(html).not.toContain("npm install");
    expect(html).not.toContain(":registry=");
    expect(html).toContain("No snapshots in this deploy yet.");
  });

  test("declares dark-mode classes so the visitor preference takes effect automatically", () => {
    const html = renderLanding(samplePackages, "https://x.test", "main");
    expect(html).toContain("dark:bg-slate-950");
    expect(html).toContain("dark:text-slate-100");
  });

  test("declares a favicon link so browsers stop falling back to /favicon.ico", () => {
    const html = renderLanding(samplePackages, "https://x.test", "main");
    expect(html).toMatch(/<link[^>]*rel="icon"[^>]*href="\/favicon\.svg"/);
  });

  test("escapes HTML-special characters in branch names so injection is impossible", () => {
    const html = renderLanding(samplePackages, "https://x.test", "<script>alert(1)</script>");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});

describe("ROBOTS_TXT", () => {
  test("disallows every user agent", () => {
    expect(ROBOTS_TXT).toContain("User-agent: *");
    expect(ROBOTS_TXT).toContain("Disallow: /");
  });
});
