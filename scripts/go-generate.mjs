#!/usr/bin/env node
/**
 * Runs the module's `//go:generate` directives, packages in parallel.
 *
 * `go generate ./...` is strictly serial, and the directives are almost pure
 * per-invocation overhead — mockgen spends ~800ms type-loading a package
 * whether it mocks one interface or twenty. Running the four mockgen packages
 * concurrently collapses 4.3s into 1.4s, and the five enumer ones 2.2s into
 * 1.6s.
 *
 * That is ~21% end to end (6.4s against 8.1s), not the 4x the arithmetic
 * suggests, because `./api` is a serial chain and now the larger half of the
 * run: `gen_openapi_errors` type-loads the whole module to infer error sets,
 * and 2.6s of the 3.5s api phase is that one analysis. It parallelizes against
 * nothing — see the ordering below — so it sets the floor. Worth knowing
 * before optimizing the phases around it.
 *
 * The ordering that matters is a phase boundary, not a package-internal one.
 * `./api` runs alone between the two `rest` phases, for a reason on each side:
 *
 *   - after enumer, because `api/cmd/gen_openapi_errors` type-loads
 *     `./internal/...` to infer each handler's error set, and `internal/domain`
 *     does not type-check until its `*_enumer.go` files exist.
 *   - before mockgen, because that same load — and `gen_error_schemas` parsing
 *     `internal/domain` source — must observe those trees at rest, rather than
 *     while mockgen is writing `.go` files into them.
 *
 * Within a package `go generate` keeps directives in file order, which is what
 * keeps api's own chain (error schemas -> openapi errors -> ogen) intact.
 *
 * That chain closes a cycle on a pruned tree — the analysis needs the client
 * ogen writes at the end of it — which `api/cmd/gen_openapi_errors` breaks from
 * the inside, by generating a bootstrap client for itself. Nothing about it is
 * this runner's business; bare `go generate ./...` gets the same treatment.
 *
 * Today the mockgen race would be benign — enumer writes via a same-directory
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

// Runs alone, between the enumer and mockgen phases — see the module comment.
const ORDERED_PACKAGE = "api";

const DIRECTIVE = /^\/\/go:generate /m;

export async function goGenerate({ log = console.log } = {}) {
  const packages = findGeneratePackages();
  const ordered = packages.filter((dir) => dir === ORDERED_PACKAGE);
  const rest = packages.filter((dir) => dir !== ORDERED_PACKAGE);

  // enumer writes .go files *into* a package; mockgen and the api generators
  // type-load packages. So every enumer directive must finish before any of
  // them runs, or a package whose generated methods do not exist yet is loaded
  // and the load fails.
  //
  // Under `go generate ./...` that ordering comes for free, because the
  // mockgen directives live in the mock subpackages and `./...` walks packages
  // in import-path order. This runner deliberately ignores that order — it
  // runs packages concurrently — so it has to restate the constraint as an
  // explicit barrier. Both paths bootstrap from a tree holding no generated
  // file that can be regenerated from one; there is a standing check for that
  // (server:check-generate-pruned).
  //
  // The barrier is global rather than per-package on purpose: internal/service
  // imports internal/domain, so its mockgen needs *domain's* enumer output,
  // not just its own package's.
  await runPhase(rest, ENUMER_PHASE, log);

  for (const dir of ordered) {
    log(`--- ${dir}`);
    await run("go", ["generate", "."], { cwd: join(ROOT, dir) });
  }

  await runPhase(rest, MOCKGEN_PHASE, log);
}

// `go generate -run` filters directives by matching against the command text.
// A generator added later that neither writes into nor loads a package can go
// in either phase; one that does both needs its own entry here.
const ENUMER_PHASE = { name: "enumer", filter: "enumer" };
const MOCKGEN_PHASE = { name: "mockgen", filter: "mockgen" };

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
