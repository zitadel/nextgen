#!/usr/bin/env node
import { run, runCapture } from "./dev-process.mjs";

const GENERATED_PATHS = [
  "api/generated",
  "api/openapi/components/schemas/errors",
  "api/openapi/endpoints",
  "internal/crypto/mock",
  "internal/domain",
  "internal/instrumentation",
  "internal/service/mocks",
];

const before = await gitState();
await run("go", ["generate", "./..."]);
const after = await gitState();

if (after !== before) {
  console.error("go generate changed the worktree.");
  console.error("Review the generated diff, commit intentional updates, then rerun this task.");
  await printGeneratedDiff();
  process.exit(1);
}

async function gitState() {
  const [diff, status] = await Promise.all([
    runCapture("git", ["diff", "--no-ext-diff", "--binary", "--", ...GENERATED_PATHS]),
    runCapture("git", ["status", "--porcelain=v1", "-z", "--", ...GENERATED_PATHS]),
  ]);
  return `${diff.stdout}\0${status.stdout}`;
}

async function printGeneratedDiff() {
  const [status, names] = await Promise.all([
    runCapture("git", ["status", "--short", "--", ...GENERATED_PATHS]),
    runCapture("git", ["diff", "--name-only", "--", ...GENERATED_PATHS]),
  ]);

  if (status.stdout.trim()) {
    console.error(status.stdout.trim());
  }
  if (names.stdout.trim()) {
    console.error(names.stdout.trim());
  }
}
