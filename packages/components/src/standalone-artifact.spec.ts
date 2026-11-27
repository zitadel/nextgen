/**
 * Guards the self-contained promise of `dist/standalone.mjs` (the `test` task
 * depends on `build` in turbo.json for exactly this reason). A release packs
 * that same build (`turbo run pack --filter=@zitadel/release`), so the
 * published artifact is the one checked here; see
 * `scripts/check-standalone-artifact.mjs` for the failure modes it exists to
 * catch.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { findArtifactViolations } from "../scripts/check-standalone-artifact.mjs";

// Resolved from the package cwd, not `import.meta.url` — vite rewrites module
// URLs (server-relative or `/@fs/…`), and vitest always runs with the package
// directory as cwd.
const STANDALONE_PATH = join(process.cwd(), "dist/standalone.mjs");

describe("standalone artifact", () => {
  it("the built dev artifact is self-contained", () => {
    const source = readFileSync(STANDALONE_PATH, "utf8");
    expect(findArtifactViolations(source)).toEqual([]);
  });

  it("the checker catches the known-bad shapes", () => {
    expect(
      findArtifactViolations(`import { MANDATORY_GATES_TAG } from "@zitadel/config/template";\n`),
    ).not.toEqual([]);
    expect(findArtifactViolations(`import { createRequire } from "node:module";\n`)).not.toEqual(
      [],
    );
    expect(findArtifactViolations(`const m = await import("@zitadel/config");\n`)).not.toEqual([]);
    expect(
      findArtifactViolations(
        `import { x } from "./chunk.mjs";\nimport "/abs.mjs";\nconst d = await import("./lazy.mjs");\n`,
      ),
    ).toEqual([]);
  });
});
