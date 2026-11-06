import { readFile, readdir } from "node:fs/promises";
import { join, normalize, posix, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { LOCAL_IMPORT, resolveFromSrc } from "@tests/helpers/source-imports";

const root = fileURLToPath(new URL("../../../../src", import.meta.url));
const LAYER = posix.join("lib", "oclif");

/**
 * The modules outside the layer that the glue may reach for, each standing for
 * itself and everything under it: the envelope and its errors, the command
 * line, the palette, the spelling it is printed in, the suggestion builders,
 * the telemetry and process plumbing every command pays for, and the backend
 * the generated resource commands speak through.
 */
const GENERIC = [
  "lib/backend",
  "lib/cmd",
  "lib/consent",
  "lib/errors",
  "lib/host",
  "lib/input",
  "lib/json",
  "lib/paths",
  "lib/public-cli",
  "lib/server",
  "lib/style",
  "lib/suggestion",
  "lib/telemetry",
  "lib/terminal-text",
  "lib/user-agent",
  "lib/warnings",
];

/**
 * Product knowledge the glue still reaches for, each one a leak to move into
 * the commands that own it. The list only shrinks: a new one fails the test.
 */
const LEAKS = [
  "lib/environment",
  "lib/journey-guidance",
  "lib/local-server/processes",
  "lib/skills-hint",
];

/**
 * Domain libs that still reach into the layer, each one a dependency pointing
 * the wrong way. The list only shrinks: a new one fails the test. `lib/server`
 * and `lib/telemetry/consent` want a type the envelope owns, `lib/claim-state`
 * wants the server-kind bucket, and `lib/api-request` is the `zitadel api`
 * argument parser, which reads the generated commands' own helpers.
 */
const INBOUND = [
  "lib/api-request.ts",
  "lib/claim-state.ts",
  "lib/server.ts",
  "lib/telemetry/consent.ts",
];

/**
 * A path as this file reads one: `readdir` answers in the platform's
 * separator, and every path here is compared as a module specifier is written.
 */
function asSpecifier(path: string): string {
  return path.split(sep).join(posix.sep);
}

/** Every `.ts` file in the layer, as a path relative to `src`. */
async function layerFiles(): Promise<string[]> {
  const files = await readdir(join(root, LAYER), { recursive: true });
  return files
    .filter((file) => file.endsWith(".ts"))
    .map((file) => posix.join(LAYER, asSpecifier(file)));
}

/**
 * What `file` imports from outside the layer, each as a path relative to
 * `src` with no extension.
 */
async function reachesOutside(file: string): Promise<string[]> {
  const source = await readFile(join(root, file), "utf8");
  const outside: string[] = [];
  for (const match of source.matchAll(LOCAL_IMPORT)) {
    const specifier = match[1];
    if (specifier === undefined) {
      continue;
    }
    const target = resolveFromSrc(file, specifier).replace(/\.(ts|js)$/, "");
    if (!target.startsWith(`${LAYER}/`) && target !== LAYER) {
      outside.push(target);
    }
  }
  return outside;
}

/**
 * What `directory`, relative to `src`, holds. Empty for one that is not there,
 * which is also all git records of a directory whose files are gone.
 */
async function filesIn(directory: string): Promise<string[]> {
  return readdir(join(root, normalize(directory)), { recursive: true })
    .then((files) => files.filter((file) => file.endsWith(".ts")).map(asSpecifier))
    .catch(() => []);
}

/** Whether `target` is `module` or something under it. */
function within(target: string, module: string): boolean {
  return target === module || target.startsWith(`${module}/`);
}

describe("the oclif layer", () => {
  it("holds no product knowledge of its own, so a command's inputs live with the command", async () => {
    const allowed = [...GENERIC, ...LEAKS];
    const leaking: string[] = [];

    for (const file of await layerFiles()) {
      for (const target of await reachesOutside(file)) {
        if (!allowed.some((module) => within(target, module))) {
          leaking.push(`${file} -> ${target}`);
        }
      }
    }

    expect(leaking).toEqual([]);
  });

  it("never imports a command, so the generic layer does not depend on a specific one", async () => {
    const importing: string[] = [];

    for (const file of await layerFiles()) {
      for (const target of await reachesOutside(file)) {
        if (target.startsWith("commands/")) {
          importing.push(`${file} -> ${target}`);
        }
      }
    }

    expect(importing).toEqual([]);
  });

  it("has no bag for the inputs and preconditions that belong to a command", async () => {
    const bagged: string[] = [];

    for (const bag of ["lib/oclif/inputs", "lib/oclif/requires"]) {
      bagged.push(...(await filesIn(bag)).map((file) => posix.join(bag, file)));
    }

    expect(bagged).toEqual([]);
  });

  it("is imported by no domain lib, so the dependency runs one way only", async () => {
    const inbound: string[] = [];
    const libs = (await readdir(join(root, "lib"), { recursive: true }))
      .filter((file) => {
        return file.endsWith(".ts");
      })
      .map((file) => {
        return posix.join("lib", asSpecifier(file));
      })
      .filter((file) => {
        return !file.startsWith(`${LAYER}/`) && !INBOUND.includes(file);
      });

    for (const file of libs) {
      const source = await readFile(join(root, file), "utf8");
      for (const match of source.matchAll(LOCAL_IMPORT)) {
        const target = resolveFromSrc(file, match[1] ?? "");
        if (target === LAYER || target.startsWith(`${LAYER}/`)) {
          inbound.push(`${file} -> ${target}`);
        }
      }
    }

    expect(inbound).toEqual([]);
  });
});
