import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, join } from "node:path";

import { describe, expect, test } from "vitest";

import { DISPATCHED_EVENTS } from "./events.js";

// Resolved from the package cwd, not `import.meta.url`: vite rewrites module
// URLs under jsdom (same convention as events.spec.ts). `cem analyze` reads the
// element sources and the committed manifest is its output, so regenerating
// here and diffing proves the checked-in file is current — it fails the moment
// an element gains a property or event without `pnpm cem` being rerun.
const root = process.cwd();
const cem = createRequire(join(root, "noop.js")).resolve(
  "@custom-elements-manifest/analyzer/cem.js",
);

interface Declaration {
  readonly tagName?: string;
  readonly events?: readonly { readonly name: string }[];
}
interface Manifest {
  readonly modules: readonly { readonly declarations?: readonly Declaration[] }[];
}

function declarations(manifest: Manifest): Declaration[] {
  return manifest.modules.flatMap((module) => [...(module.declarations ?? [])]);
}

function parse(file: string): Manifest {
  const manifest: Manifest = JSON.parse(readFileSync(file, "utf8"));
  return manifest;
}

/**
 * `it` with `dir`, a fresh directory the analyzer writes into, removed when the
 * test ends. The analyzer resolves `--outdir` against its cwd, so the directory
 * lives under the package root and is passed by its relative name.
 */
const it = test.extend<{ dir: string }>({
  // biome-ignore lint/correctness/noEmptyPattern: Vitest requires a destructured first argument.
  async dir({}, use) {
    const dir = mkdtempSync(join(root, ".cem-"));
    await use(dir);
    rmSync(dir, { recursive: true, force: true });
  },
});

function regenerate(out: string): Manifest {
  execFileSync(process.execPath, [cem, "analyze", "--outdir", basename(out)], { cwd: root });
  return parse(join(out, "custom-elements.json"));
}

const committed = parse(join(root, "custom-elements.json"));

const EXPECTED_TAGS = [
  "zitadel-login",
  "zitadel-logout",
  "zitadel-session",
  "zl-account",
  "zl-alert",
  "zl-avatar",
  "zl-button",
  "zl-card",
  "zl-checkbox",
  "zl-field",
  "zl-icon",
  "zl-page-shell",
  "zl-passkey",
  "zl-pill",
  "zl-select",
  "zl-sso-providers",
];

describe("custom-elements.json", () => {
  it("is up to date with the element sources", ({ dir }) => {
    expect(committed).toEqual(regenerate(dir));
  });

  it("declares every zitadel-* and zl-* element", () => {
    const tags = declarations(committed)
      .map((declaration) => declaration.tagName)
      .filter((tag): tag is string => tag !== undefined)
      .sort();
    expect(tags).toEqual([...EXPECTED_TAGS].sort());
  });

  it("declares every dispatched widget event", () => {
    const events = new Set(
      declarations(committed).flatMap((declaration) =>
        (declaration.events ?? []).map((event) => event.name),
      ),
    );
    for (const event of DISPATCHED_EVENTS) {
      expect(events.has(event)).toBe(true);
    }
    for (const event of ["zl-submit", "zl-input", "zl-change", "zl-dismiss", "zl-sso-select"]) {
      expect(events.has(event)).toBe(true);
    }
  });
});
