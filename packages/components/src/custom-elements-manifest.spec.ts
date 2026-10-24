import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, join } from "node:path";

import { describe, expect, it } from "vitest";

import { DISPATCHED_EVENTS } from "./events.js";
import { manifestRegistry } from "./manifests.js";
import { buildBrandingStylesheet } from "./orchestrator/branding-to-tokens.js";
import type {
  BrandingPalette,
  BrandingShape,
  BrandingTypography,
} from "./orchestrator/branding.js";
import { exportpartsFor } from "./orchestrator/exportparts.js";
import "./orchestrator/zitadel-logout.js";
import "./orchestrator/zitadel-session.js";

// Resolved from the package cwd, not `import.meta.url`: vite rewrites module
// URLs under jsdom (same convention as events.spec.ts). `cem analyze` reads the
// element sources and the committed manifest is its output, so regenerating
// here and diffing proves the checked-in file is current — it fails the moment
// an element gains a property or event without `pnpm cem` being rerun.
const root = process.cwd();
const cem = createRequire(join(root, "noop.js")).resolve(
  "@custom-elements-manifest/analyzer/cem.js",
);

interface Named {
  readonly name: string;
}
interface Declaration {
  readonly tagName?: string;
  readonly events?: readonly Named[];
  readonly cssParts?: readonly Named[];
  readonly cssProperties?: readonly Named[];
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

function regenerate(): Manifest {
  // The analyzer resolves `--outdir` against its cwd, so the temp dir lives
  // under the package root and is passed by its relative name.
  const out = mkdtempSync(join(root, ".cem-"));
  try {
    execFileSync(process.execPath, [cem, "analyze", "--outdir", basename(out)], { cwd: root });
    return parse(join(out, "custom-elements.json"));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
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

/** `<zitadel-login>`'s own parts, beside the atom parts it forwards (override ladder, tier 2). */
const LOGIN_PARTS = ["form", "paired-identifier", "attribution", "attribution-mark"];

function declared(tag: string): Declaration {
  const declaration = declarations(committed).find((candidate) => candidate.tagName === tag);
  if (!declaration) throw new Error(`custom-elements.json declares no <${tag}>`);
  return declaration;
}

function sortedNames(entries: readonly Named[] | undefined): string[] {
  return (entries ?? []).map((entry) => entry.name).sort();
}

/** The names an `exportparts` value exports: `input: field-input` gives `field-input`. */
function exported(exportparts: string | null | undefined): string[] {
  return (exportparts ?? "")
    .split(",")
    .map((mapping) => mapping.split(":")[1]?.trim() ?? "")
    .filter((name) => name !== "");
}

/** What the element really forwards once rendered, logout's menu open. */
async function forwardedOnRender(tag: "zitadel-session" | "zitadel-logout"): Promise<string[]> {
  const element = document.createElement(tag);
  document.body.append(element);
  try {
    await element.updateComplete;
    element.shadowRoot?.querySelector<HTMLButtonElement>(".trigger")?.click();
    await element.updateComplete;
    return [...(element.shadowRoot?.querySelectorAll("[exportparts]") ?? [])]
      .flatMap((atom) => exported(atom.getAttribute("exportparts")))
      .sort();
  } finally {
    element.remove();
  }
}

/**
 * A revision that sets every key, so its stylesheet names every variable
 * branding can set. `Required` turns a key added to the wire type into a type
 * error here until it is set.
 */
function everyBrandingKey(): string {
  const palette: Required<BrandingPalette> = {
    primary: "red",
    on_primary: "red",
    background: "red",
    surface: "red",
    muted: "red",
    border: "red",
    text: "red",
    text_muted: "red",
    link: "red",
    success: "red",
    warning: "red",
    error: "red",
  };
  const typography: Required<BrandingTypography> = {
    font_family: "serif",
    font_url: "https://fonts.example.com/face.css",
    scale: 1.25,
  };
  const shape: Required<BrandingShape> = { radius: "md", density: "compact", logo_scale: 2 };
  return buildBrandingStylesheet({
    theme: { light: { palette }, dark: { palette } },
    typography,
    shape,
  });
}

describe("custom-elements.json", () => {
  it("is up to date with the element sources", () => {
    expect(committed).toEqual(regenerate());
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

  it("lists each atom's manifest parts under their bare names", () => {
    for (const manifest of manifestRegistry) {
      expect(sortedNames(declared(manifest.tag).cssParts), manifest.tag).toEqual(
        [...manifest.parts].sort(),
      );
    }
  });

  it("lists <zitadel-login>'s own parts and every registered atom's forwarded ones", () => {
    // The sanitiser admits every registered atom into a template, so the
    // login can render, and forwards, any of them.
    const forwarded = manifestRegistry.flatMap((manifest) =>
      exported(exportpartsFor(manifest.tag)),
    );
    expect(sortedNames(declared("zitadel-login").cssParts)).toEqual(
      [...LOGIN_PARTS, ...forwarded].sort(),
    );
  });

  it.each(["zitadel-session", "zitadel-logout"] as const)(
    "lists exactly the parts <%s> forwards once rendered",
    async (tag) => {
      expect(sortedNames(declared(tag).cssParts)).toEqual(await forwardedOnRender(tag));
    },
  );

  it("lists the stable tokens on every orchestrator: the variables branding sets", () => {
    const branded = [...new Set(everyBrandingKey().match(/--zl-[a-z0-9-]+/g))].sort();
    expect(branded).not.toEqual([]);
    for (const tag of ["zitadel-login", "zitadel-session", "zitadel-logout"]) {
      // A mismatch means a branding key changed: update the `@cssprop` list
      // on `ZitadelConfigured` (src/orchestrator/surface.ts) and run `pnpm cem`.
      expect(sortedNames(declared(tag).cssProperties), tag).toEqual(branded);
    }
  });
});
