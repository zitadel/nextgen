import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ZitadelLogin } from "./orchestrator/zitadel-login.js";
import { ZitadelLogout } from "./orchestrator/zitadel-logout.js";
import { ZitadelSession } from "./orchestrator/zitadel-session.js";

/**
 * Drift guard for the hand-authored `src/jsx.d.ts` (shipped as
 * `@zitadel/components/jsx`). The declaration file is excluded from this
 * package's TS programs (it needs React's types, which are not installed
 * here), so nothing else fails when an element gains a reactive property the
 * declarations don't mention. This spec closes that gap textually: every
 * public entry in each element's `elementProperties` — Lit's static reactive
 * property map — must appear in the matching declaration block, named by its
 * attribute where one is declared and by property name otherwise.
 */

// Resolved from the package cwd, not `import.meta.url` — vite rewrites module
// URLs (server-relative or `/@fs/…`), and vitest always runs with the package
// directory as cwd (same convention as standalone-artifact.spec.ts).
const declarationText = readFileSync(join(process.cwd(), "src/jsx.d.ts"), "utf-8");

type Declaration = { attribute?: string | boolean; state?: boolean };
type ElementCtor = (typeof ZitadelLogin | typeof ZitadelSession | typeof ZitadelLogout) & {
  elementProperties: Map<PropertyKey, Declaration>;
};

/** The declaration block for one element: its entry up to the next element. */
function declarationBlock(tag: string): string {
  const start = declarationText.indexOf(`"${tag}":`);
  expect(start, `jsx.d.ts declares <${tag}>`).toBeGreaterThanOrEqual(0);
  const rest = declarationText.slice(start + `"${tag}":`.length);
  const next = rest.search(/"zitadel-[a-z]+":/);
  return next === -1 ? rest : rest.slice(0, next);
}

/**
 * JSX-facing names of a class's public reactive properties: `@state`
 * declarations are internal and skipped; attribute-backed properties are
 * named by their attribute, property-only ones (`attribute: false`) by the
 * property itself.
 */
function jsxSurface(ctor: ElementCtor, tag: string): string[] {
  // Force Lit finalization so `elementProperties` is fully populated even if
  // a decorator flavour defers it to first construction.
  document.createElement(tag);
  const names: string[] = [];
  for (const [prop, decl] of ctor.elementProperties) {
    if (decl.state) continue;
    names.push(typeof decl.attribute === "string" ? decl.attribute : String(prop));
  }
  return names;
}

describe.each([
  ["zitadel-login", ZitadelLogin],
  ["zitadel-session", ZitadelSession],
  ["zitadel-logout", ZitadelLogout],
] as const)("jsx.d.ts declarations for <%s>", (tag, ctor) => {
  it("covers every public reactive property", () => {
    const names = jsxSurface(ctor as ElementCtor, tag);
    // Sanity: an empty surface would make the loop below pass vacuously.
    expect(names.length).toBeGreaterThan(0);
    const block = declarationBlock(tag);
    for (const name of names) {
      // Entries render as `name?:` or `"kebab-name"?:`. The leading
      // boundary keeps a short name (`url`) from matching inside a longer
      // one (`"post-sign-out-url"`).
      expect(block, `<${tag}> declares "${name}"`).toMatch(
        new RegExp(`(^|[^\\w"-])"?${name}"?\\?:`),
      );
    }
  });
});
