import { readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { sourceFiles } from "@tests/helpers/source-files";
import { COMMANDS as COMMAND_TABLE } from "@/index";
import { EnvironmentCommand } from "@/lib/oclif/environment-command";
import { Spelling } from "@/lib/suggestion";

describe("Spelling#command", () => {
  it("pins an alpha's follow-ups to its own version", () => {
    expect(Spelling.at("0.1.0-alpha.1").command("start")).toBe(
      "npx @zitadel/cli@0.1.0-alpha.1 start",
    );
  });

  it("pins a release's follow-ups to its own version", () => {
    expect(Spelling.at("0.1.0").command("start")).toBe("npx @zitadel/cli@0.1.0 start");
  });

  it("preserves command args exactly", () => {
    expect(Spelling.at("0.1.0-alpha.1").command("setup --server local")).toBe(
      "npx @zitadel/cli@0.1.0-alpha.1 setup --server local",
    );
  });

  it("keeps non-alpha prereleases on their dist-tag", () => {
    expect(Spelling.at("0.1.0-beta.2").command("start")).toBe("npx @zitadel/cli@beta start");
  });

  it("normalizes bare zitadel follow-ups and leaves other commands alone", () => {
    expect(Spelling.at("0.1.0-alpha.1").normalizeCommand("zitadel doctor --fix")).toBe(
      "npx @zitadel/cli@0.1.0-alpha.1 doctor --fix",
    );
    expect(Spelling.at("0.1.0-alpha.1").normalizeCommand("npm install")).toBe("npm install");
    expect(Spelling.at("0.1.0-alpha.1").normalizeCommand("docker version")).toBe("docker version");
  });
});

describe("Spelling#exploreAllCommands", () => {
  it("points at the CLI run with no subcommand, on a line of its own", () => {
    expect(Spelling.at("0.1.0").exploreAllCommands()).toBe(
      "Explore all commands:\n  npx @zitadel/cli@0.1.0",
    );
  });
});

describe("Spelling#newestCommand", () => {
  it("points at the dist-tag, not the exact version", () => {
    expect(Spelling.at("0.1.0-alpha.1").newestCommand("upgrade")).toBe(
      "npx @zitadel/cli@alpha upgrade",
    );
    expect(Spelling.at("v0.1.0").newestCommand("upgrade")).toBe("npx @zitadel/cli@latest upgrade");
  });
});

describe("Spelling#normalizeCommands", () => {
  it("rewrites each zitadel command and passes an absent list through", () => {
    expect(
      Spelling.at("0.1.0").normalizeCommands(["zitadel", "zitadel doctor", "npm install"]),
    ).toEqual(["npx @zitadel/cli@0.1.0", "npx @zitadel/cli@0.1.0 doctor", "npm install"]);
    expect(Spelling.at("0.1.0").normalizeCommands(undefined)).toBeUndefined();
  });
});

describe("Spelling#spellOut", () => {
  it("spells a quoted zitadel command out as the one that runs, without backticks", () => {
    expect(Spelling.at("0.1.0-alpha.1").spellOut("Run `zitadel setup` first.")).toBe(
      "Run npx @zitadel/cli@0.1.0-alpha.1 setup first.",
    );
  });

  it("spells out each command in a hint, and the one after a pipe", () => {
    expect(
      Spelling.at("0.1.0").spellOut(
        "Run `zitadel reset --force`, then `zitadel start`; or `cat body.json | zitadel api x`.",
      ),
    ).toBe(
      "Run npx @zitadel/cli@0.1.0 reset --force, then npx @zitadel/cli@0.1.0 start; or cat body.json | npx @zitadel/cli@0.1.0 api x.",
    );
  });

  it("takes the backticks off anything else that was quoted, and leaves the words", () => {
    expect(Spelling.at("0.1.0").spellOut("Set one with `variable set`, or pass `--preview`.")).toBe(
      "Set one with variable set, or pass --preview.",
    );
  });

  it("leaves a file name that merely starts with the word alone", () => {
    expect(Spelling.at("0.1.0").spellOut("Edit `zitadel.json` and `.zitadel/secret`.")).toBe(
      "Edit zitadel.json and .zitadel/secret.",
    );
  });
});

describe("Spelling#normalizeProse", () => {
  it("rewrites inline code spans to the public npx form", () => {
    expect(
      Spelling.at("0.1.0-alpha.1").normalizeProse("2. `zitadel plan` — validates the template."),
    ).toBe("2. `npx @zitadel/cli@0.1.0-alpha.1 plan` — validates the template.");
    expect(
      Spelling.at("0.1.0-alpha.1").normalizeProse(
        "Start over with `zitadel branding eject --design <name>`.",
      ),
    ).toBe("Start over with `npx @zitadel/cli@0.1.0-alpha.1 branding eject --design <name>`.");
  });

  it("rewrites a bare `zitadel` span and fenced-block command lines", () => {
    expect(Spelling.at("0.1.0-alpha.1").normalizeProse("run `zitadel` for help")).toBe(
      "run `npx @zitadel/cli@0.1.0-alpha.1` for help",
    );
    expect(Spelling.at("0.1.0-alpha.1").normalizeProse("```sh\nzitadel apply\n```")).toBe(
      "```sh\nnpx @zitadel/cli@0.1.0-alpha.1 apply\n```",
    );
  });

  it("leaves file names and unrelated prose untouched", () => {
    const prose = "Edit `zitadel.json` and `.zitadel/branding/branding.json`; `zitadel.db` stays.";
    expect(Spelling.at("0.1.0-alpha.1").normalizeProse(prose)).toBe(prose);
    expect(Spelling.at("0.1.0-alpha.1").normalizeProse("`npm install` then `git push`")).toBe(
      "`npm install` then `git push`",
    );
  });
});

describe("Spelling#normalizeJson", () => {
  it("rewrites command spans in nested strings without mutating the input", () => {
    const body = {
      description: "`zitadel apply` publishes this as a revision.",
      properties: { layout: { examples: ["run `zitadel branding eject --design minimal`"] } },
    };
    const before = JSON.stringify(body);

    const out = Spelling.at("0.1.0-alpha.1").normalizeJson(body);

    expect(out.description).toBe(
      "`npx @zitadel/cli@0.1.0-alpha.1 apply` publishes this as a revision.",
    );
    expect(out.properties.layout.examples[0]).toBe(
      "run `npx @zitadel/cli@0.1.0-alpha.1 branding eject --design minimal`",
    );
    expect(JSON.stringify(body)).toBe(before);
  });

  it("leaves non-string leaves and unspanned prose alone", () => {
    const out = Spelling.at("0.1.0-alpha.1").normalizeJson({
      // A description is prose, not a command line: the fenced-block rule
      // `Spelling#normalizeProse` applies must not fire here.
      description: "zitadel resolves the latest revision per project.",
      maxLength: 131072,
      additionalProperties: false,
      pattern: "^https://",
      nothing: null,
    });

    expect(out).toEqual({
      description: "zitadel resolves the latest revision per project.",
      maxLength: 131072,
      additionalProperties: false,
      pattern: "^https://",
      nothing: null,
    });
  });
});

/**
 * The one name, enforced over the source rather than per call site.
 *
 * A reader of a terminal sees one command spelling or three. The public
 * `npx @zitadel/cli@<version> …` form is the one that runs on their machine —
 * the CLI is not a dependency of the app it scaffolds — so it is the only
 * spelling human output uses, and {@link Spelling.command}, through a
 * `lib/suggestion/` builder, is the only thing that writes it. Two spellings
 * reach the terminal by hand, and this scan refuses both: a command written
 * out as bare `zitadel …`, which does not exist on the reader's PATH, and a
 * backtick, which a terminal prints as a backtick rather than as code.
 *
 * Comments are exempt — the bare spelling is the readable one to write about a
 * command in prose about the code — so they are blanked before a rule reads a
 * line, which is also why a failure's line number is the one in the file.
 */
describe("the CLI names itself once in human output", () => {
  const COMMANDS = join(import.meta.dirname, "../../../../src/cli/commands");

  /**
   * The source with every comment blanked, keeping each line where it was.
   *
   * String literals are matched first and kept. A slash-star inside a string
   * such as `@zitadel/*` would otherwise open a comment that runs to the next
   * real comment close and blanks every line a person reads in between. That
   * hid twenty lines of `doctor/index.ts` from this scan, one an offender.
   */
  const blankComments = (source: string): string =>
    source.replaceAll(
      /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
      (match) => (match.startsWith("/") ? match.replaceAll(/[^\n]/g, " ") : match),
    );

  /** The double-quoted string literals on a line, quotes included. */
  const quoted = (line: string): string[] => line.match(/"(?:[^"\\\n]|\\.)*"/g) ?? [];

  /** The string literals on a line a person could end up reading: both kinds. */
  const literals = (line: string): string[] => [
    ...quoted(line),
    ...(line.match(/`(?:[^`\\\n]|\\.)*`/g) ?? []),
  ];

  /**
   * A failure's `hint:`. It may quote a command in backticks: the base command
   * spells every hint out on its way to the terminal (`Spelling#spellOut`), so
   * the backticks never reach a person.
   */
  const HINT = /\bhint:/;

  /** A path as a failure names it, with forward slashes on every platform. */
  const asWritten = (file: string): string =>
    relative(join(COMMANDS, ".."), file).split(sep).join("/");

  async function offenders(offends: (line: string) => boolean): Promise<string[]> {
    const files = await sourceFiles(COMMANDS);
    const found = await Promise.all(
      files.map(async (file) => {
        const name = asWritten(file);
        const lines = blankComments(await readFile(file, "utf8")).split("\n");
        return lines.flatMap((line, index) => {
          return !HINT.test(line) && offends(line) ? [`${name}:${index + 1}`] : [];
        });
      }),
    );
    return found.flat().sort();
  }

  it("quotes no command in backticks, which a terminal does not render", async () => {
    // An escaped backtick is one inside a template literal; a plain one inside
    // a double-quoted string is the other way a backtick reaches the terminal.
    const offends = (line: string): boolean =>
      line.includes("\\`") || quoted(line).some((literal) => literal.includes("`"));

    expect(await offenders(offends)).toEqual([]);
  });

  it("writes out no bare zitadel command for a person to copy", async () => {
    const offends = (line: string): boolean =>
      literals(line).some((literal) => /\bzitadel [a-z]/.test(literal));

    expect(await offenders(offends)).toEqual([]);
  });

  it("names no project-scoped command in prose, which would run without the run's selector", async () => {
    const ids = Object.keys(COMMAND_TABLE)
      .map((id) => id.replaceAll(":", " "))
      .sort((a, b) => b.length - a.length);
    const scoped = new Set(
      Object.entries(COMMAND_TABLE)
        .filter(([, command]) => command.prototype instanceof EnvironmentCommand)
        .map(([id]) => id.replaceAll(":", " ")),
    );
    const files = await sourceFiles(join(COMMANDS, "../.."));
    const found = await Promise.all(
      files.map(async (file) => {
        const name = relative(join(COMMANDS, "../.."), file).split(sep).join("/");
        const lines = blankComments(await readFile(file, "utf8")).split("\n");
        return lines.flatMap((line, index) => {
          const named = literals(line).some((literal) => {
            return [...literal.matchAll(/\bzitadel ((?:[a-z][a-z-]*)(?: [a-z][a-z-]*)*)/g)].some(
              (match) => {
                const words = match[1] ?? "";
                // The longest command the words begin with is the one named:
                // `api ls` is not `api`.
                const named = ids.find((id) => words === id || words.startsWith(`${id} `));
                return named !== undefined && scoped.has(named);
              },
            );
          });
          return named ? [`${name}:${index + 1}`] : [];
        });
      }),
    );

    expect(found.flat().sort()).toEqual([]);
  });
});
