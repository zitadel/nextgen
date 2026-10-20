/**
 * Guards the self-contained promise of `dist/standalone.mjs` for the DEV
 * build (`components:test` depends on `components:build` in moon.yml for
 * exactly this reason). The release build runs the same checks inline —
 * `components:build-release` invokes `scripts/check-standalone-artifact.mjs`
 * after building — so both artifacts are covered by one checker; see that
 * script for the failure modes it exists to catch.
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  findArtifactViolations,
  findLibraryViolations,
} from "../scripts/check-standalone-artifact.mjs";

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
        `import { x } from "./chunk.mjs";\nimport "/abs.mjs";\nconst d = await import("./lazy.mjs");\nconst SHADOW_ROOT_MODE = "closed";\n`,
      ),
    ).toEqual([]);
  });

  it("the checker refuses a build whose shadow roots are not closed", () => {
    expect(findArtifactViolations(`const SHADOW_ROOT_MODE = "open";\n`)).not.toEqual([]);
    expect(findArtifactViolations(`const SHADOW_ROOT_MODE = void 0;\n`)).not.toEqual([]);
    expect(findArtifactViolations(`export const x = 1;\n`)).not.toEqual([]);
  });

  it("the built library closes the shadow roots", () => {
    expect(findLibraryViolations(join(process.cwd(), "dist"))).toEqual([]);
  });

  describe("the library checker", () => {
    function libraryWith(files: Record<string, string>): string {
      const dir = mkdtempSync(join(tmpdir(), "library-"));
      for (const [name, source] of Object.entries(files)) {
        mkdirSync(join(dir, name, ".."), { recursive: true });
        writeFileSync(join(dir, name), source);
      }
      return dir;
    }

    it("accepts a chunk that closes the mode", () => {
      const dir = libraryWith({ "atoms-1.mjs": `const SHADOW_ROOT_MODE = "closed";\n` });
      expect(findLibraryViolations(dir)).toEqual([]);
    });

    it("refuses a chunk that leaves the mode open", () => {
      const dir = libraryWith({
        "atoms-1.mjs": `const SHADOW_ROOT_MODE = "closed";\n`,
        "orchestrator/chunk.mjs": `const SHADOW_ROOT_MODE = "open";\n`,
      });
      expect(findLibraryViolations(dir)).not.toEqual([]);
    });

    it("refuses a library that never sets the mode", () => {
      expect(findLibraryViolations(libraryWith({ "index.mjs": "export {};\n" }))).not.toEqual([]);
    });
  });
});
