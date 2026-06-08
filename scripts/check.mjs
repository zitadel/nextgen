#!/usr/bin/env node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { forwardedArgs, run, runCapture } from "./dev-process.mjs";

const phases = new Map([
  ["openapi", phaseOpenApi],
  ["go", phaseGo],
  ["go:postgres", phaseGoPostgres],
  ["go:spanner", phaseGoSpanner],
  ["node", phaseNode],
  ["node:e2e", phaseNodeE2e],
  ["pack", phasePack],
  ["release", phaseRelease],
  ["journey", phaseJourney],
]);
const fullOrder = [...phases.keys()];
const fastOrder = ["openapi", "go", "node"];

const options = parseArgs(forwardedArgs());
const selected = options.only ? [options.only] : options.full ? fullOrder : fastOrder;

for (const phase of selected) {
  console.log(`\n==> ${phase}`);
  try {
    await phases.get(phase)();
    console.log(`ok  ${phase}`);
  } catch (error) {
    console.error(`\nfailed phase: ${phase}`);
    console.error(error.message);
    console.error(`rerun: corepack pnpm run check -- --only ${phase}`);
    process.exit(error.code ?? 1);
  }
}

console.log(`\nZitadel local check passed (${selected.join(", ")}).`);

function parseArgs(args) {
  const parsed = { full: false, fast: false, only: "" };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--fast":
        parsed.fast = true;
        break;
      case "--full":
        parsed.full = true;
        break;
      case "--only":
        parsed.only = args[++index] ?? "";
        if (!parsed.only) {
          usage("--only requires a phase");
        }
        break;
      case "--help":
      case "-h":
        usage();
        break;
      default:
        usage(`unknown argument: ${arg}`);
    }
  }

  if (parsed.fast && parsed.full) {
    usage("choose either --fast or --full");
  }
  if (parsed.only && (parsed.fast || parsed.full)) {
    usage("--only cannot be combined with --fast or --full");
  }
  if (parsed.only && !phases.has(parsed.only)) {
    usage(`unknown phase: ${parsed.only}`);
  }
  return parsed;
}

function usage(error) {
  if (error) {
    console.error(error);
    console.error("");
  }
  console.log(`usage: corepack pnpm run check -- [--fast | --full | --only <phase>]

Default is --fast.

Phases:
  ${fullOrder.join("\n  ")}
`);
  process.exit(error ? 1 : 0);
}

async function phaseOpenApi() {
  await run("npx", [
    "--yes",
    "@redocly/cli@2.31.5",
    "lint",
    "api/openapi/openapi-spec.yaml",
    "--format=github-actions",
  ]);
}

async function phaseGo() {
  await run("sh", [
    "-c",
    `unformatted="$(git ls-files -z -- '*.go' | xargs -0 -r gofmt -l)"
if [ -n "$unformatted" ]; then
  printf '%s\n' "$unformatted"
  exit 1
fi`,
  ]);

  const before = await gitState();
  await run("go", ["generate", "./..."]);
  const after = await gitState();
  if (after !== before) {
    throw new Error(
      [
        "go generate changed the worktree.",
        "Review the generated diff, commit intentional updates, then rerun this phase.",
      ].join("\n"),
    );
  }

  await run("go", ["vet", "./..."]);
  await run("go", ["test", "-v", "-timeout=10m", "./..."]);
}

async function phaseGoPostgres() {
  await run("go", ["test", "-json", "-v", "-tags", "postgres_integration", "-timeout=10m", "./..."]);
}

async function phaseGoSpanner() {
  await run("go", ["test", "-v", "-tags", "spanner_integration", "-timeout=10m", "./..."]);
}

async function phaseNode() {
  await run("corepack", ["pnpm", "install", "--frozen-lockfile"]);
  await run("corepack", ["pnpm", "nx", "run-many", "-t", "lint,typecheck,build,test"]);
}

async function phaseNodeE2e() {
  await run("corepack", [
    "pnpm",
    "--filter",
    "@zitadel/demo-next-e2e",
    "exec",
    "playwright",
    "install",
    "chromium",
  ]);
  await run("corepack", [
    "pnpm",
    "nx",
    "run-many",
    "-t",
    "e2e",
    "-p",
    "@zitadel/demo-next-e2e,@zitadel/demo-nuxt-e2e",
  ]);
}

async function phasePack() {
  const packageDirs = [
    "apps/cli",
    "packages/api",
    "packages/components",
    "packages/sdk-core",
    "packages/sdk-next",
    "packages/sdk-nuxt",
  ];
  await run("corepack", ["pnpm", "nx", "run-many", "-t", "build"]);
  await run(process.execPath, ["apps/cli/bin/run.js", "--version"]);
  await run(process.execPath, ["apps/cli/bin/run.js", "commands"]);

  for (const dir of packageDirs) {
    await run("corepack", ["pnpm", "--dir", dir, "pack", "--dry-run"]);
  }

  const tarballsDir = await mkdtemp(join(tmpdir(), "zitadel-pack-"));
  try {
    for (const dir of packageDirs) {
      await run("corepack", ["pnpm", "--dir", dir, "pack", "--pack-destination", tarballsDir]);
    }
    await run(process.execPath, [
      "apps/cli-journey-e2e/scripts/verify-tarballs.mjs",
      tarballsDir,
    ]);
  } finally {
    await rm(tarballsDir, { recursive: true, force: true });
  }
}

async function phaseRelease() {
  await run("goreleaser", ["release", "--snapshot", "--clean", "--skip=publish,sign"]);
}

async function phaseJourney() {
  await run(process.execPath, ["scripts/run-journey.mjs"]);
}

async function gitState() {
  const [diff, status] = await Promise.all([
    runCapture("git", ["diff", "--no-ext-diff", "--binary", "--", "."]),
    runCapture("git", ["status", "--porcelain=v1", "-z"]),
  ]);
  return `${diff.stdout}\0${status.stdout}`;
}
