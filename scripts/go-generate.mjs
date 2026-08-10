#!/usr/bin/env node
/**
 * Runs the module's `//go:generate` directives, packages in parallel.
 *
 * `go generate ./...` is strictly serial, and the directives are almost pure
 * per-invocation overhead — mockgen spends ~800ms type-loading a package
 * whether it mocks one interface or twenty. Running packages concurrently is
 * therefore nearly a free 4x.
 *
 * The ordering that matters is a phase boundary, not a package-internal one:
 * `api/cmd/gen_error_schemas` and `api/cmd/gen_openapi_errors` parse
 * `internal/domain` and `internal/service` *source* to discover error codes,
 * so they must observe those trees at rest. `./api` therefore runs alone in
 * phase 1, before any generator writes into the trees it reads. Within a
 * package `go generate` keeps directives in file order, which is what keeps
 * api's own chain (error schemas -> openapi errors -> ogen) intact.
 *
 * Today that race would be benign — enumer writes via a same-directory
 * `os.Rename` and its temp files carry no `.go` suffix, and the generated
 * `*_enumer.go` files declare no error constructors — but that is a property
 * of the current tools, not an invariant anyone declared. The phase boundary
 * costs ~0.3s and removes the class.
 */
import { availableParallelism } from "node:os";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { isDirectRun, mapWithConcurrency, run, runCapture } from "./dev-process.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

// Never hold Go sources, and walking them dwarfs the rest of discovery.
const SKIP_DIRS = new Set(["node_modules", ".git", ".moon", "dist", "target", ".next", ".turbo"]);

// Runs alone in phase 1 — see the module comment.
const ORDERED_FIRST = "api";

const DIRECTIVE = /^\/\/go:generate /m;

export async function goGenerate({ log = console.log } = {}) {
  const packages = findGeneratePackages();
  const first = packages.filter((dir) => dir === ORDERED_FIRST);
  const rest = packages.filter((dir) => dir !== ORDERED_FIRST);

  for (const dir of first) {
    log(`--- ${dir}`);
    await run("go", ["generate", "."], { cwd: join(ROOT, dir) });
  }

  // enumer writes .go files *into* a package; mockgen type-loads packages. So
  // every enumer directive must finish before any mockgen one, or mockgen
  // loads a package whose generated methods do not exist yet and fails. This
  // is what lets generation bootstrap from a tree with no generated files at
  // all (see scripts/clean-generated.mjs).
  //
  // The barrier is global rather than per-package on purpose: internal/service
  // imports internal/domain, so its mockgen needs *domain's* enumer output,
  // not just its own package's.
  for (const phase of GENERATE_PHASES) {
    await runPhase(rest, phase, log);
  }
}

// `go generate -run` filters directives by matching against the command text.
// A generator added later that neither writes into nor loads a package can go
// in either phase; one that does both needs its own entry here.
const GENERATE_PHASES = [
  { name: "enumer", filter: "enumer" },
  { name: "mockgen", filter: "mockgen" },
];

async function runPhase(dirs, phase, log) {
  const limit = Math.max(1, Math.min(availableParallelism(), dirs.length));
  await mapWithConcurrency(dirs, limit, async (dir) => {
    // Buffered per package so concurrent generators never interleave. On
    // failure runCapture folds both streams into the thrown error's message.
    const { stdout, stderr } = await runCapture("go", ["generate", "-run", phase.filter, "."], {
      cwd: join(ROOT, dir),
    });
    const output = `${stdout}${stderr}`.trim();
    // Most packages have nothing to do in a given phase; only say so when
    // something actually ran.
    if (output) {
      log(`--- ${dir} (${phase.name})\n${output}`);
    }
  });
}

/**
 * Every directory holding a `//go:generate` directive, repo-relative.
 *
 * Each is generated with `go generate .` rather than `./...`, so a directory
 * whose subdirectories also hold directives (`internal/instrumentation` over
 * `zotel` and `zlog`) does not run them a second time — which would otherwise
 * put two processes on the same output file concurrently.
 */
function findGeneratePackages() {
  const found = new Set();

  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          walk(join(dir, entry.name));
        }
        continue;
      }
      if (!entry.name.endsWith(".go")) {
        continue;
      }
      if (DIRECTIVE.test(readFileSync(join(dir, entry.name), "utf8"))) {
        found.add(relative(ROOT, dir));
      }
    }
  };

  walk(ROOT);
  return [...found].sort();
}

if (isDirectRun(import.meta.url)) {
  try {
    await goGenerate();
  } catch (error) {
    // runCapture folds the generator's own stdout/stderr into the message; a
    // Node stack trace on top of it only buries the line that explains the
    // failure.
    console.error(error.message);
    process.exitCode = 1;
  }
}
