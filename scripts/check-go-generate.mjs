#!/usr/bin/env node
import { run, runCapture } from "./dev-process.mjs";

const before = await gitState();
await run("go", ["generate", "./..."]);
const after = await gitState();

if (after !== before) {
  console.error("go generate changed the worktree.");
  console.error("Review the generated diff, commit intentional updates, then rerun this task.");
  process.exit(1);
}

async function gitState() {
  const [diff, status] = await Promise.all([
    runCapture("git", ["diff", "--no-ext-diff", "--binary", "--", "."]),
    runCapture("git", ["status", "--porcelain=v1", "-z"]),
  ]);
  return `${diff.stdout}\0${status.stdout}`;
}
