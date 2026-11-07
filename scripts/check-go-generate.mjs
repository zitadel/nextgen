#!/usr/bin/env node
/**
 * Fails when the committed generated files are not what the generators
 * produce from the sources beside them.
 *
 * It never writes the working tree, so it runs beside every task that reads
 * those files. It copies the repository's files (tracked, and untracked ones
 * git does not ignore) into a temporary directory, links the root
 * node_modules into it, and runs generation there (scripts/go-generate.mjs,
 * which deletes the generated files before regenerating them). Then it
 * compares the generated files of the two trees: a file that comes back
 * different is drift, one that does not come back is output nothing generates
 * any more. Generating from a tree with no generated files in it also guards
 * the bootstrap property (gen_openapi_errors breaks its own cycle).
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { run, runCapture } from "./dev-process.mjs";
import { collectGeneratedFiles } from "./generated-outputs.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** The generated files of the copy that differ, and those it lacks. */
async function compareWithFreshGeneration(copy) {
  const { stdout } = await runCapture(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: ROOT },
  );
  for (const rel of stdout.split("\0")) {
    // A tracked file deleted in the working tree is listed but gone.
    if (rel && existsSync(join(ROOT, rel))) {
      mkdirSync(dirname(join(copy, rel)), { recursive: true });
      copyFileSync(join(ROOT, rel), join(copy, rel));
    }
  }
  symlinkSync(join(ROOT, "node_modules"), join(copy, "node_modules"), "dir");

  await run("node", [join(copy, "scripts/go-generate.mjs")], { cwd: copy });

  const expected = collectGeneratedFiles(copy).generated;
  const produced = new Set(expected);
  return {
    stale: expected.filter(
      (rel) =>
        !existsSync(join(ROOT, rel)) ||
        !readFileSync(join(ROOT, rel)).equals(readFileSync(join(copy, rel))),
    ),
    orphaned: collectGeneratedFiles(ROOT).generated.filter((rel) => !produced.has(rel)),
  };
}

const copy = mkdtempSync(join(tmpdir(), "zitadel-check-generate-"));
try {
  const { stale, orphaned } = await compareWithFreshGeneration(copy);
  if (stale.length > 0) {
    console.error("Generated files that differ from what generation produces:");
    for (const rel of stale) console.error(`  ${rel}`);
  }
  if (orphaned.length > 0) {
    console.error("Generated files that nothing generates any more:");
    for (const rel of orphaned) console.error(`  ${rel}`);
  }
  if (stale.length > 0 || orphaned.length > 0) {
    console.error("");
    console.error("Run `turbo run generate --filter=@zitadel/server` and commit the result.");
    process.exitCode = 1;
  }
} catch (error) {
  // The generator's own output is already above; its stack would bury it.
  console.error(error.message);
  console.error("Generation failed in a copy of the working tree.");
  process.exitCode = 1;
} finally {
  // Unlink first, so removing the copy can never reach the real node_modules.
  try {
    unlinkSync(join(copy, "node_modules"));
  } catch {}
  rmSync(copy, { recursive: true, force: true });
}
