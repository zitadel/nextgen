import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { LIGHT_DOM_TAGS, registeredElements } from "../__tests__/registered-elements.js";

import { SHADOW_ROOT_MODE, ZlElement } from "./shadow-root.js";

const elements = await registeredElements(() => import("../index.js"));
const rootBearing = elements.filter(({ tag }) => !LIGHT_DOM_TAGS.includes(tag));

// Resolved from the package cwd, not `import.meta.url` — vite rewrites module
// URLs, and vitest always runs with the package directory as cwd.
const DIST = join(process.cwd(), "dist");

/** The root options of a class that derives from ZlElement, else `undefined`. */
function shadowRootOptionsOf(
  ctor: CustomElementConstructor | undefined,
): ShadowRootInit | undefined {
  return ctor?.prototype instanceof ZlElement ? Reflect.get(ctor, "shadowRootOptions") : undefined;
}

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

  it("finds the whole package, the atoms and the three orchestrators", () => {
    const tags = elements.map(({ tag }) => tag);
    expect(tags).toEqual(expect.arrayContaining(["zl-field", "zl-button", "zitadel-login"]));
    expect(tags).toEqual(expect.arrayContaining(["zitadel-session", "zitadel-logout"]));
    expect(rootBearing.length).toBeGreaterThanOrEqual(13);
  });

  it.each(rootBearing)("<$tag> takes its root options from ZlElement", ({ ctor }) => {
    expect(ctor.prototype).toBeInstanceOf(ZlElement);
    expect(shadowRootOptionsOf(ctor)?.mode).toBe(SHADOW_ROOT_MODE);
  });

  it.each(LIGHT_DOM_TAGS)("<%s> has no shadow root to close", (tag) => {
    const element = document.createElement(tag);
    document.body.appendChild(element);
    expect(element.shadowRoot).toBeNull();
    element.remove();
  });

  it("keeps the focus delegation the form atoms and the login widget add", () => {
    for (const tag of ["zl-field", "zl-select", "zl-checkbox", "zl-button", "zitadel-login"]) {
      expect(shadowRootOptionsOf(customElements.get(tag))?.delegatesFocus, tag).toBe(true);
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
