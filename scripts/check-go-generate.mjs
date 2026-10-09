#!/usr/bin/env node
/**
 * Fails when the committed generated output does not match what the
 * generators produce.
 *
 * With `--prune` it additionally deletes every generated file first, so output
 * that nothing generates any more surfaces as a deletion instead of lingering
 * forever. That is the stronger check and the one CI runs; it is kept off the
 * default path because `vet` and `test` depend on this task, and rewriting a
 * developer's worktree as a side effect of running tests would be rude.
 *
 * `--prune` also standing-guards the bootstrap property: generation has to work
 * against a tree with no generated files in it at all, or this fails.
 */
import { runCapture } from "./dev-process.mjs";
import { cleanGenerated } from "./clean-generated.mjs";
import { GENERATED_GLOBS } from "./generated-outputs.mjs";
import { goGenerate } from "./go-generate.mjs";

// Same globs the cleaner uses, as git pathspecs — a narrower hand-maintained
// list silently missed idgenmock/ and user_examples/, which matters far more
// once --prune can delete them.
const PATHSPECS = GENERATED_GLOBS.map((glob) => `:(glob)${glob}`);

const prune = process.argv.includes("--prune");

const before = await gitState();
try {
  if (prune) {
    cleanGenerated({ quiet: true });
  }
  await goGenerate();
} catch (error) {
  // The generator's own output is already folded into the message; a stack
  // trace on top of it only buries the line that explains the failure.
  console.error(error.message);
  if (prune) {
    console.error("");
    console.error("Generated files were deleted before this failure — run");
    console.error("`moon run server:generate` to restore them.");
  }
  process.exit(1);
}
const after = await gitState();

if (after !== before) {
  const missing = await deletedFiles();
  if (missing.length > 0) {
    console.error("Generated files that nothing generates any more:");
    for (const file of missing) {
      console.error(`  ${file}`);
    }
    console.error("");
    console.error("A directive stopped producing these — a renamed destination, or an");
    console.error("interface no longer mocked. Commit their deletion.");
  } else {
    console.error("go generate changed the worktree.");
    console.error("Review the generated diff, commit intentional updates, then rerun this task.");
  }
  await printGeneratedDiff();
  process.exit(1);
}

async function gitState() {
  const [diff, status] = await Promise.all([
    runCapture("git", ["diff", "--no-ext-diff", "--binary", "--", ...PATHSPECS]),
    runCapture("git", ["status", "--porcelain=v1", "-z", "--", ...PATHSPECS]),
  ]);
  return `${diff.stdout}\0${status.stdout}`;
}

/** Tracked generated files missing from the worktree — i.e. orphans. */
async function deletedFiles() {
  const { stdout } = await runCapture("git", [
    "diff",
    "--name-only",
    "--diff-filter=D",
    "--",
    ...PATHSPECS,
  ]);
  return stdout.split("\n").filter(Boolean);
}

async function printGeneratedDiff() {
  const [status, names] = await Promise.all([
    runCapture("git", ["status", "--short", "--", ...PATHSPECS]),
    runCapture("git", ["diff", "--name-only", "--", ...PATHSPECS]),
  ]);

  if (status.stdout.trim()) {
    console.error(status.stdout.trim());
  }
  if (names.stdout.trim()) {
    console.error(names.stdout.trim());
  }
}
