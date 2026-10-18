import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import * as client from "../client";
import * as index from "../index";
import * as server from "../server";

// The package ships only what its build emits, so an `exports` target the build
// misses breaks every consumer that imports it. `test` runs after `build`.
describe("package manifest", () => {
  const packageRoot = resolve(import.meta.dirname, "../..");
  const manifest = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8")) as {
    main?: string;
    module?: string;
    types?: string;
    exports: unknown;
    peerDependencies: Record<string, string>;
  };

  function targets(value: unknown): string[] {
    if (typeof value === "string") return value.startsWith("./") ? [value] : [];
    if (value && typeof value === "object") return Object.values(value).flatMap(targets);
    return [];
  }

  it("ships every exports target in dist", () => {
    const declared = targets([manifest.exports, manifest.main, manifest.module, manifest.types]);
    expect(declared.length).toBeGreaterThan(0);
    expect(declared.filter((file) => !existsSync(resolve(packageRoot, file)))).toEqual([]);
  });

  it("declares its supported peer ranges", () => {
    expect(manifest.peerDependencies).toEqual({
      "@sveltejs/kit": "^2.0.0 || ^3.0.0",
      svelte: "^5.0.0",
    });
  });
});

/**
 * `@zitadel/sdk-sveltekit` is server-only: the `<zitadel-*>` widgets come from
 * `@zitadel/sdk-svelte`, whose specs check every config key against the element.
 * If an entry here ever exports a widget wrapper, it needs the same
 * "wrapper config parity" checks, so this fails until they are added.
 */
describe("wrapper config parity", () => {
  it("exports no <zitadel-login>, <zitadel-session> or <zitadel-logout> wrapper", () => {
    const wrappers = Object.entries({ index, client, server }).flatMap(([entry, exports]) =>
      Object.keys(exports)
        .filter((name) => /^Zitadel(Login|Session|Logout)/.test(name))
        .map((name) => `${entry}:${name}`),
    );
    expect(wrappers).toEqual([]);
  });
});
