import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import "../atoms/index.js";
import { listKnownTags } from "../manifests.js";
import "../orchestrator/index.js";

import { SHADOW_ROOT_MODE, ZlElement } from "./shadow-root.js";

const ORCHESTRATOR_TAGS = ["zitadel-login", "zitadel-session", "zitadel-logout"];

/**
 * Elements that render into their own light DOM and so have no root to open or
 * close. Anything else in the registry must derive from {@link ZlElement}.
 */
const LIGHT_DOM_TAGS = ["zl-passkey"];

const ROOT_BEARING_TAGS = [...listKnownTags(), ...ORCHESTRATOR_TAGS].filter(
  (tag) => !LIGHT_DOM_TAGS.includes(tag),
);

// Resolved from the package cwd, not `import.meta.url` — vite rewrites module
// URLs, and vitest always runs with the package directory as cwd.
const DIST = join(process.cwd(), "dist");

function builtModules(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return builtModules(path);
    return path.endsWith(".mjs") ? [path] : [];
  });
}

describe("shadow root mode in the source build", () => {
  it("is open, so component tests and Playwright can pierce the roots", () => {
    expect(SHADOW_ROOT_MODE).toBe("open");
    expect(ZlElement.shadowRootOptions.mode).toBe("open");
  });

  it.each(ROOT_BEARING_TAGS)("<%s> takes its root options from ZlElement", (tag) => {
    const ctor = customElements.get(tag);
    expect(ctor, `${tag} is not registered`).toBeDefined();
    expect(ctor?.prototype).toBeInstanceOf(ZlElement);
    const { shadowRootOptions } = ctor as unknown as typeof ZlElement;
    expect(shadowRootOptions.mode).toBe(SHADOW_ROOT_MODE);
  });

  it.each(LIGHT_DOM_TAGS)("<%s> has no shadow root to close", (tag) => {
    const element = document.createElement(tag);
    document.body.appendChild(element);
    expect(element.shadowRoot).toBeNull();
    element.remove();
  });

  it("keeps the focus delegation the form atoms and the login widget add", () => {
    for (const tag of ["zl-field", "zl-select", "zl-checkbox", "zl-button", "zitadel-login"]) {
      const { shadowRootOptions } = customElements.get(tag) as unknown as typeof ZlElement;
      expect(shadowRootOptions.delegatesFocus, tag).toBe(true);
    }
  });
});

describe("shadow root mode in the built package", () => {
  const modules = builtModules(DIST);
  const sources = modules.map((path) => ({ path, source: readFileSync(path, "utf8") }));

  it("builds the mode into the library chunks and the standalone file", () => {
    const setters = sources.filter(({ source }) => /\bconst SHADOW_ROOT_MODE = /.test(source));
    const names = setters.map(({ path }) => path.slice(DIST.length + 1));
    expect(names).toContain("standalone.mjs");
    expect(names.length).toBeGreaterThanOrEqual(2);
  });

  it("builds it closed everywhere it is set", () => {
    for (const { path, source } of sources) {
      for (const [, value] of source.matchAll(/\bconst SHADOW_ROOT_MODE = ([^;\n]+);/g)) {
        expect(value, path).toBe('"closed"');
      }
    }
  });

  it("leaves no unresolved build-time flag behind", () => {
    for (const { path, source } of sources) {
      expect(source, path).not.toContain("__ZITADEL_SHADOW_ROOT_MODE__");
    }
  });
});
