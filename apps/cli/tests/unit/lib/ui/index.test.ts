import { readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import * as ui from "../../../../src/lib/ui";
import { drawsDirectly } from "../../../helpers/drawing-boundary";
import { sourceFiles } from "../../../helpers/source-files";

const SRC = join(import.meta.dirname, "../../../../src");
const PACKAGE = join(SRC, "lib/ui");

/** A path as the rule is written, with forward slashes on every platform. */
const asWritten = (file: string): string => relative(SRC, file).split(sep).join("/");

/**
 * What the narration bridge still carries: a command that says things with
 * `consola`, or writes to a stream itself, instead of through the UI package.
 * Moving these is the rest of the one-chain-per-command work; until then the
 * list is pinned so the debt cannot grow.
 */
const STILL_DRAWING_THEMSELVES = [
  "commands/api/index.ts: imports consola",
  "commands/auth-method/sso/enable/index.ts: imports consola",
  "commands/branding/eject.ts: imports consola",
  "commands/claim/index.ts: imports consola",
  "commands/console.ts: imports consola",
  "commands/doctor/index.ts: imports consola",
  "commands/env/add/index.ts: imports consola",
  "commands/logs/index.ts: writes to process.stdout",
  "hooks/version-notice.ts: writes to process.stderr",
  "lib/idp/credentials.ts: imports consola",
  "lib/input.ts: imports @clack/prompts",
  "lib/local-server/server.ts: imports consola",
  "commands/auth-method/command.ts: imports consola",
  "lib/oclif/base.ts: imports consola",
  "lib/oclif/base.ts: writes to process.stderr",
  "lib/publish/steps/asset-probe.ts: imports consola",
  "lib/skills-hint.ts: imports consola",
  "lib/telemetry/sink.ts: writes to process.stderr",
  "lib/warnings.ts: imports consola",
].sort();

/**
 * The commands that walk a person through something, and so draw a chain and
 * a box. Pinned because the set is the rule: a command that quietly takes the
 * marker, or quietly loses it, changes how it looks on every run, and nothing
 * else in the suite would notice.
 */
const WIZARDS = ["setup/index.ts"];

describe("which shape a command draws", () => {
  it("is declared by `setup` alone, the one command that walks a person through several stages", async () => {
    const declared: string[] = [];
    for (const file of await sourceFiles(join(SRC, "commands"))) {
      const source = await readFile(file, "utf8");
      if (/static override wizard = true/.test(source)) {
        declared.push(relative(join(SRC, "commands"), file).split(sep).join("/"));
      }
    }

    expect(declared.sort()).toEqual(WIZARDS);
  });
});

describe("the UI package", () => {
  it("hands out the ways to draw, and nothing it draws with", async () => {
    expect(Object.keys(ui).sort()).toEqual(["Ui", "outcome", "section"]);
  });

  // The package is the only place the CLI draws. Everything else returns what
  // it wants said and lets `this.ui` decide how it looks, so that `--json`
  // stays one envelope, every box is the same width, and a line always lands
  // in the chain it belongs to.
  it("is the only place that draws, apart from the narration still to be moved", async () => {
    const offenders: string[] = [];
    for (const file of await sourceFiles(SRC)) {
      if (file.startsWith(`${PACKAGE}${sep}`)) {
        continue;
      }
      for (const how of drawsDirectly(await readFile(file, "utf8"))) {
        offenders.push(`${asWritten(file)}: ${how}`);
      }
    }

    // Exactly the files that still say things for themselves, listed so that a
    // new one cannot be added quietly and each one that moves into the UI
    // package has to be struck off here. The list only ever shrinks.
    expect(offenders.sort()).toEqual(STILL_DRAWING_THEMSELVES);
  });

  it("draws with the packages it says it draws with", async () => {
    const drawing: string[] = [];
    for (const file of await sourceFiles(PACKAGE)) {
      if (drawsDirectly(await readFile(file, "utf8")).length > 0) {
        drawing.push(asWritten(file));
      }
    }

    expect(drawing.sort()).toEqual([
      "lib/ui/chain.ts",
      "lib/ui/narration.ts",
      "lib/ui/progress.ts",
      "lib/ui/spinner.ts",
    ]);
  });
});

describe("asking a person", () => {
  // Every question is a clack prompt asked through `lib/input.ts`. A module
  // that opens a line reader of its own would ask in a second way, with its
  // own look, its own echo and its own idea of Ctrl-C.
  it("is done with clack alone, so no module reads a line from the terminal itself", async () => {
    const readers: string[] = [];
    for (const file of await sourceFiles(SRC)) {
      const source = await readFile(file, "utf8");
      if (/["'](?:node:)?readline(?:\/promises)?["']/.test(source)) {
        readers.push(asWritten(file));
      }
    }

    expect(readers).toEqual([]);
  });
});

describe("the boundary scan", () => {
  it.each([
    ["a clack import", 'import { note } from "@clack/prompts";', ["imports @clack/prompts"]],
    ["a clack require", 'const c = require("@clack/prompts");', ["imports @clack/prompts"]],
    ["a consola import", 'import { consola } from "consola";', ["imports consola"]],
    ["a default consola import", 'import consola from "consola";', ["imports consola"]],
    [
      "a multi-line import",
      'import {\n  log,\n} from "@clack/prompts";',
      ["imports @clack/prompts"],
    ],
    ["a console line", "console.log(`hello`);", ["calls console.log"]],
    ["a console error", "console.error(problem);", ["calls console.error"]],
    ["a write to stdout", "process.stdout.write(line);", ["writes to process.stdout"]],
    ["a write to stderr", "process.stderr.write(line);", ["writes to process.stderr"]],
  ])("catches %s", (_form, source, expected) => {
    expect(drawsDirectly(source)).toEqual(expected);
  });

  it.each([
    ["consola's string helpers", 'import { box, stripAnsi } from "consola/utils";'],
    ["another package", 'import { log } from "@clack/core";'],
    ["a child process's own streams", "child.stdout?.pipe(target);"],
    ["prose that quotes a forbidden call", "// never consola.warn; use reportWarning"],
    ["a block comment that shows one", "/** `process.stdout.write` is the UI's alone. */"],
  ])("leaves %s alone", (_form, source) => {
    expect(drawsDirectly(source)).toEqual([]);
  });
});
