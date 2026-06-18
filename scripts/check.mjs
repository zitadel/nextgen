#!/usr/bin/env node
import { forwardedArgs, run } from "./dev-process.mjs";

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
const fullOrder = [...phases.keys()].filter((phase) => phase !== "node:e2e");
const fastOrder = ["openapi", "go", "node"];
const explicitOnlyPhases = [...phases.keys()].filter((phase) => !fullOrder.includes(phase));

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
    console.error(`rerun: moon run workspace:check -- --only ${phase}`);
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
        if (!parsed.only) usage("--only requires a phase");
        break;
      case "--help":
      case "-h":
        usage();
        break;
      default:
        usage(`unknown argument: ${arg}`);
    }
  }

  if (parsed.fast && parsed.full) usage("choose either --fast or --full");
  if (parsed.only && (parsed.fast || parsed.full)) usage("--only cannot be combined with --fast or --full");
  if (parsed.only && !phases.has(parsed.only)) usage(`unknown phase: ${parsed.only}`);
  return parsed;
}

function usage(error) {
  if (error) {
    console.error(error);
    console.error("");
  }
  console.log(`usage: moon run workspace:check -- [--fast | --full | --only <phase>]

Default is --fast.

Full phases:
  ${fullOrder.join("\n  ")}

Explicit-only phases:
  ${explicitOnlyPhases.join("\n  ")}
`);
  process.exit(error ? 1 : 0);
}

async function phaseOpenApi() {
  await run("moon", ["run", "server:openapi"]);
}

async function phaseGo() {
  await run("moon", ["run", "server:test"]);
}

async function phaseGoPostgres() {
  await run("moon", ["run", "server:test-postgres"]);
}

async function phaseGoSpanner() {
  await run("moon", ["run", "server:test-spanner"]);
}

async function phaseNode() {
  await run("corepack", ["pnpm", "install", "--frozen-lockfile"]);
  await run("moon", ["ci", ":lint", ":typecheck", ":build", ":test"]);
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
  await run("moon", ["run", "demo-next-e2e:e2e"]);
  await run("moon", ["run", "demo-nuxt-e2e:e2e"]);
}

async function phasePack() {
  await run("moon", ["run", "release:pack"]);
}

async function phaseRelease() {
  await run("node", ["scripts/release.mjs", "snapshot", "--skip-container"]);
}

async function phaseJourney() {
  await run(process.execPath, ["scripts/run-journey.mjs"]);
}
