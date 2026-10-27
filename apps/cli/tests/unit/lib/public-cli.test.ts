import { readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { sourceFiles } from "../../helpers/source-files";
import {
  maskPublicCliVersion,
  normalizePublicCliCommand,
  normalizePublicCliJson,
  normalizePublicCliProse,
  npmDistTagForCliVersion,
  npmSelectorForCliVersion,
  optionArgs,
  portableCommands,
  publicCliCommand,
  sdkVersionForCli,
} from "../../../src/lib/public-cli";

describe("public CLI command formatting", () => {
  it("keeps dist-tag detection separate from alpha follow-up selectors", () => {
    expect(npmDistTagForCliVersion("0.1.0-alpha.1")).toBe("alpha");
    expect(npmSelectorForCliVersion("0.1.0-alpha.1")).toBe("0.1.0-alpha.1");
    expect(publicCliCommand("start", "0.1.0-alpha.1")).toBe("npx @zitadel/cli@0.1.0-alpha.1 start");
  });

  it.each([
    ["1.0.0-alpha.25", "1.0.0-alpha.25"],
    ["v1.0.0-alpha.25", "1.0.0-alpha.25"],
    ["0.1.0", "0.1.0"],
    ["1.0.0", "1.0.0"],
    ["1.0.0-beta.2", "beta"],
  ])("pins scaffolded SDKs for CLI %s at %s", (cliVersion, expected) => {
    expect(sdkVersionForCli(cliVersion)).toBe(expected);
  });

  it("pins a release's follow-ups to its own version, whose dist-tag is latest", () => {
    expect(npmDistTagForCliVersion("0.1.0")).toBe("latest");
    expect(publicCliCommand("start", "0.1.0")).toBe("npx @zitadel/cli@0.1.0 start");
  });

  it("preserves command args exactly", () => {
    expect(publicCliCommand("setup --server local", "0.1.0-alpha.1")).toBe(
      "npx @zitadel/cli@0.1.0-alpha.1 setup --server local",
    );
  });

  it("keeps non-alpha prereleases on their dist-tag", () => {
    expect(publicCliCommand("start", "0.1.0-beta.2")).toBe("npx @zitadel/cli@beta start");
  });

  it("normalizes bare zitadel follow-ups and leaves other commands alone", () => {
    expect(normalizePublicCliCommand("zitadel doctor --fix", "0.1.0-alpha.1")).toBe(
      "npx @zitadel/cli@0.1.0-alpha.1 doctor --fix",
    );
    expect(normalizePublicCliCommand("npm install", "0.1.0-alpha.1")).toBe("npm install");
    expect(normalizePublicCliCommand("docker version", "0.1.0-alpha.1")).toBe("docker version");
  });
});

describe("normalizePublicCliProse", () => {
  it("rewrites inline code spans to the public npx form", () => {
    expect(
      normalizePublicCliProse("2. `zitadel plan` — validates the template.", "0.1.0-alpha.1"),
    ).toBe("2. `npx @zitadel/cli@0.1.0-alpha.1 plan` — validates the template.");
    expect(
      normalizePublicCliProse(
        "Start over with `zitadel branding eject --design <name>`.",
        "0.1.0-alpha.1",
      ),
    ).toBe("Start over with `npx @zitadel/cli@0.1.0-alpha.1 branding eject --design <name>`.");
  });

  it("rewrites a bare `zitadel` span and fenced-block command lines", () => {
    expect(normalizePublicCliProse("run `zitadel` for help", "0.1.0-alpha.1")).toBe(
      "run `npx @zitadel/cli@0.1.0-alpha.1` for help",
    );
    expect(normalizePublicCliProse("```sh\nzitadel apply\n```", "0.1.0-alpha.1")).toBe(
      "```sh\nnpx @zitadel/cli@0.1.0-alpha.1 apply\n```",
    );
  });

  it("leaves file names and unrelated prose untouched", () => {
    const prose = "Edit `zitadel.json` and `.zitadel/branding/branding.json`; `zitadel.db` stays.";
    expect(normalizePublicCliProse(prose, "0.1.0-alpha.1")).toBe(prose);
    expect(normalizePublicCliProse("`npm install` then `git push`", "0.1.0-alpha.1")).toBe(
      "`npm install` then `git push`",
    );
  });
});

describe("normalizePublicCliJson", () => {
  it("rewrites command spans in nested strings without mutating the input", () => {
    const body = {
      description: "`zitadel apply` publishes this as a revision.",
      properties: { layout: { examples: ["run `zitadel branding eject --design minimal`"] } },
    };
    const before = JSON.stringify(body);

    const out = normalizePublicCliJson(body, "0.1.0-alpha.1");

    expect(out.description).toBe(
      "`npx @zitadel/cli@0.1.0-alpha.1 apply` publishes this as a revision.",
    );
    expect(out.properties.layout.examples[0]).toBe(
      "run `npx @zitadel/cli@0.1.0-alpha.1 branding eject --design minimal`",
    );
    expect(JSON.stringify(body)).toBe(before);
  });

  it("leaves non-string leaves and unspanned prose alone", () => {
    const out = normalizePublicCliJson(
      {
        // A description is prose, not a command line: the fenced-block rule
        // `normalizePublicCliProse` applies must not fire here.
        description: "zitadel resolves the latest revision per project.",
        maxLength: 131072,
        additionalProperties: false,
        pattern: "^https://",
        nothing: null,
      },
      "0.1.0-alpha.1",
    );

    expect(out).toEqual({
      description: "zitadel resolves the latest revision per project.",
      maxLength: 131072,
      additionalProperties: false,
      pattern: "^https://",
      nothing: null,
    });
  });
});

describe("maskPublicCliVersion", () => {
  it("makes documents normalized for different CLI versions equal", () => {
    const body = { description: "Run `zitadel deploy` to publish.", items: ["`zitadel doctor`"] };

    expect(maskPublicCliVersion(normalizePublicCliJson(body, "1.2.0"))).toEqual(
      maskPublicCliVersion(normalizePublicCliJson(body, "1.3.0")),
    );
  });

  it("keeps everything but the version", () => {
    expect(maskPublicCliVersion({ a: "`npx @zitadel/cli@1.2.0 deploy` and @zitadel/sdk" })).toEqual(
      { a: "`npx @zitadel/cli@* deploy` and @zitadel/sdk" },
    );
  });
});

describe("portableCommands", () => {
  it("prefixes every command when every argument is portable", () => {
    expect(portableCommands([["plan"], ["apply", "--cwd", "/home/dev/app"]], "1.0.0")).toEqual([
      expect.stringMatching(/ plan$/),
      expect.stringMatching(/ apply --cwd \/home\/dev\/app$/),
    ]);
  });

  it("accepts a plain value and a POSIX-style path", () => {
    expect(
      portableCommands(
        [["plan", "--schema", "default-human-user", "--cwd", "/home/dev/my-app"]],
        "1.0.0",
      ),
    ).toHaveLength(1);
  });

  it("rejects anything a POSIX shell, PowerShell or cmd.exe could read differently", () => {
    for (const value of [
      "my users",
      "x;y",
      "$(id)",
      "a&b",
      "%PATH%",
      "it's",
      "a|b",
      "a`b",
      "C:\\dev",
    ]) {
      expect(portableCommands([["plan", "--cwd", value]], "1.0.0"), value).toEqual([]);
    }
  });

  it("returns none when any argument in any command needs quoting", () => {
    expect(portableCommands([["plan"], ["apply", "--cwd", "/home/dev/my app"]], "1.0.0")).toEqual(
      [],
    );
  });
});

describe("optionArgs", () => {
  it("passes the option and its value as two arguments", () => {
    expect(optionArgs("--schema", "customers")).toEqual(["--schema", "customers"]);
  });

  it("joins a value that starts with a dash to its option", () => {
    expect(optionArgs("--schema", "--force")).toEqual(["--schema=--force"]);
  });
});

/**
 * The one name, enforced over the source rather than per call site.
 *
 * A reader of a terminal sees one command spelling or three. The public
 * `npx @zitadel/cli@<version> …` form is the one that runs on their machine —
 * the CLI is not a dependency of the app it scaffolds — so it is the only
 * spelling human output uses, and {@link publicCliCommand}, through a
 * `lib/suggestion.ts` builder, is the only thing that writes it. Two spellings
 * reach the terminal by hand, and this scan refuses both: a command written
 * out as bare `zitadel …`, which does not exist on the reader's PATH, and a
 * backtick, which a terminal prints as a backtick rather than as code.
 *
 * Comments are exempt — the bare spelling is the readable one to write about a
 * command in prose about the code — so they are blanked before a rule reads a
 * line, which is also why a failure's line number is the one in the file.
 */
describe("the CLI names itself once in human output", () => {
  const COMMANDS = join(import.meta.dirname, "../../../src/commands");

  /**
   * The commands whose prose still spells a command by hand. Pinned rather
   * than fixed here because each is another chain's to convert; the list is
   * what stops the debt growing while they are.
   */
  const NOT_YET_CONVERTED = [
    "commands/api/index.ts",
    "commands/api/ls.ts",
    "commands/deployment/rollback.ts",
    "commands/env/index.ts",
    "commands/logs.ts",
    "commands/release/create.ts",
    "commands/reset.ts",
    "commands/resources-list.ts",
    "commands/resources.ts",
    "commands/start.ts",
    "commands/stop.ts",
  ];

  /** The source with every comment blanked, keeping each line where it was. */
  const blankComments = (source: string): string =>
    source.replaceAll(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (comment) =>
      comment.replaceAll(/[^\n]/g, " "),
    );

  /** The double-quoted string literals on a line, quotes included. */
  const quoted = (line: string): string[] => line.match(/"(?:[^"\\\n]|\\.)*"/g) ?? [];

  /** The string literals on a line a person could end up reading: both kinds. */
  const literals = (line: string): string[] => [
    ...quoted(line),
    ...(line.match(/`(?:[^`\\\n]|\\.)*`/g) ?? []),
  ];

  /** A path as a failure names it, with forward slashes on every platform. */
  const asWritten = (file: string): string =>
    relative(join(COMMANDS, ".."), file).split(sep).join("/");

  async function offenders(offends: (line: string) => boolean): Promise<string[]> {
    const files = await sourceFiles(COMMANDS);
    const found = await Promise.all(
      files.map(async (file) => {
        const name = asWritten(file);
        if (NOT_YET_CONVERTED.includes(name)) {
          return [];
        }
        const lines = blankComments(await readFile(file, "utf8")).split("\n");
        return lines.flatMap((line, index) => (offends(line) ? [`${name}:${index + 1}`] : []));
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
});
