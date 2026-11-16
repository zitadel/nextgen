import { join } from "node:path";
import { readFile } from "node:fs/promises";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { COMMANDS } from "@/index";
import { BaseCommand } from "@/lib/oclif/base";
import { environmentFlags, projectEnvFile } from "@/lib/oclif/environment-flags";
import { nodesOf, parsedSource, sourcesUnder } from "@tests/helpers/declarations";
import { parseFlag } from "@tests/helpers/inputs";

/** `[name, char]` for every flag in a bag. */
const entries = (bag: Record<string, { char?: string }>): Array<[string, string | undefined]> =>
  Object.entries(bag).map(([name, flag]) => [name, flag.char]);

/** What two bags have in common by name or by short form, spelled out for the failure message. */
function clashes(
  first: Record<string, { char?: string }>,
  second: Record<string, { char?: string }>,
): string[] {
  const found: string[] = [];
  for (const [name, char] of entries(first)) {
    for (const [otherName, otherChar] of entries(second)) {
      if (name === otherName) {
        found.push(`--${name} is declared twice`);
      } else if (char !== undefined && char === otherChar) {
        found.push(`-${char} is shared by --${name} and --${otherName}`);
      }
    }
  }
  return found;
}

describe("the flag bags", () => {
  it("do not clash with the flags every command has", () => {
    expect(clashes(BaseCommand.baseFlags, environmentFlags)).toEqual([]);
  });

  it("are the same flags on every command that takes them", () => {
    // Hidden copies sit on the `auth-method` commands that only edit files and
    // resolve no environment; they exist so those commands share a base class
    // with the one that does, and `--env` means nothing to them.
    const takers = Object.values(COMMANDS).filter(
      (command) => "env" in command.baseFlags && !command.baseFlags.env.hidden,
    );

    expect(takers.length).toBeGreaterThan(0);
    for (const command of takers) {
      expect(command.baseFlags.env).toBe(environmentFlags.env);
      expect(command.baseFlags["env-file"]).toBe(environmentFlags["env-file"]);
    }
  });

  it("leave no command declaring a flag name or short form twice", () => {
    // `baseFlags` and `flags` are spread into one object by oclif, so a repeat
    // would silently replace the earlier flag rather than fail.
    for (const [id, command] of Object.entries(COMMANDS)) {
      expect(clashes(command.baseFlags, command.flags ?? {}), id).toEqual([]);
      const chars = [...entries(command.baseFlags), ...entries(command.flags ?? {})]
        .map(([, char]) => char)
        .filter((char) => char !== undefined);
      expect(new Set(chars).size, `${id} reuses a short form`).toBe(chars.length);
    }
  });
});

describe("clashes", () => {
  it("fails on a repeated name", () => {
    expect(clashes({ env: {} }, { env: {} })).toEqual(["--env is declared twice"]);
  });

  it("fails on a repeated short form", () => {
    expect(clashes({ env: { char: "e" } }, { extra: { char: "e" } })).toEqual([
      "-e is shared by --env and --extra",
    ]);
  });
});

describe("--env", () => {
  it("takes the name a shell padded with spaces, as the argument does", async () => {
    await expect(parseFlag(environmentFlags.env, " production ", "env")).resolves.toBe(
      "production",
    );
  });

  it("refuses a name no .env.<name>.local file can be called", async () => {
    await expect(parseFlag(environmentFlags.env, "../escape", "env")).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: '"../escape" is not a usable environment name',
    });
  });
});

describe("projectEnvFile", () => {
  it("names a project file as it is for a run in the project", () => {
    expect(projectEnvFile(undefined, ".env.development.local")).toBe(".env.development.local");
  });

  it("puts --cwd in front, since Node reads --env-file from the shell's directory", () => {
    expect(projectEnvFile("shop", ".env.development.local")).toBe("shop/.env.development.local");
  });

  it("keeps an absolute --cwd absolute", () => {
    expect(projectEnvFile("/work/shop/", ".env.production.local")).toBe(
      "/work/shop/.env.production.local",
    );
  });
});

/** The commands, longest name first, with whether each takes the run's `--env-file`. */
const NAMED = Object.entries(COMMANDS)
  .map(([id, command]) => {
    return {
      words: id.replaceAll(":", " "),
      scoped: "env-file" in { ...command.baseFlags, ...command.flags },
    };
  })
  .sort((first, second) => {
    return second.words.length - first.words.length;
  });

/**
 * What `zitadel init` writes into a customer's project as documentation. It is
 * read by no run, so there is no selector to carry, and no sweep may touch it
 * (`src/lib/orca/AGENTS.md`).
 */
const STATIC_DOCS = "lib/orca/";

/** What a person can read in a string: a literal, or a piece of a template. */
type Prose = ts.StringLiteralLike | ts.TemplateHead | ts.TemplateMiddle | ts.TemplateTail;

const isProse = (node: ts.Node): node is Prose => {
  return (
    ts.isStringLiteralLike(node) ||
    ts.isTemplateHead(node) ||
    ts.isTemplateMiddle(node) ||
    ts.isTemplateTail(node)
  );
};

/**
 * The lines of `text` whose strings write out `zitadel <command>` for a command
 * that takes the run's selector. Prose cannot carry it: `Spelling#spellOut`
 * only rewrites the program's name, so such a command in a hint or a message
 * would run against the default project. Comments are no strings, so they are
 * free to name one.
 *
 * @param text - A source file.
 * @returns The 1-based line each offending string starts on.
 */
function scopedCommandsNamedIn(text: string): number[] {
  const source = parsedSource("source.ts", text);
  return nodesOf(source, isProse)
    .filter((node) => {
      const spelled = [
        ...node.text.matchAll(/\bzitadel ([a-z][a-z-]*(?: [a-z][a-z-]*)*)/g),
        ...node.text.matchAll(/`([a-z][a-z-]*(?: [a-z][a-z-]*)*)[^`]*`/g),
      ];
      return spelled.some((match) => {
        const words = match[1] ?? "";
        const named = NAMED.find((command) => {
          return words === command.words || words.startsWith(`${command.words} `);
        });
        return named?.scoped === true;
      });
    })
    .map((node) => {
      return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    });
}

describe("a command that takes the run's selector", () => {
  it.each([
    ["a double-quoted string", 'const hint = "Run zitadel deploy first.";', 1],
    ["a single-quoted string", "const hint = 'Run zitadel deploy for the \"default\" flow.';", 1],
    ["a template", "const hint = `Run zitadel deploy ${where}.`;", 1],
    [
      "the middle of a multi-line template",
      "const hint = `first\n  Run zitadel deploy --dry-run\n  last`;",
      1,
    ],
    ["a nested template", "const hint = `${a ? `b` : `zitadel deploy`}`;", 1],
    [
      "a command that declares the environment flags itself",
      'const hint = "Run zitadel doctor --fix.";',
      1,
    ],
    ["a string after a lone quote", 'const both = [\'"\', "zitadel deploy"];', 1],
    ["a string on a later line", 'const a = 1;\nconst hint = "Run zitadel deploy first.";', 2],
  ])("is found in %s, on its line", (_form, text, line) => {
    expect(scopedCommandsNamedIn(text)).toEqual([line]);
  });

  it.each([
    ["a comment", "// Run zitadel deploy first.\nconst a = 1;"],
    ["a doc comment", "/** See `zitadel deploy --dry-run`. */\nconst a = 1;"],
    ["a command that takes no selector", 'const hint = "Run zitadel start first.";'],
    ["a longer command that takes none", 'const hint = "List them with zitadel api ls.";'],
    ["a name that only starts with the program's", 'const hint = "Edit zitadel.json first.";'],
  ])("is not found in %s", (_form, text) => {
    expect(scopedCommandsNamedIn(text)).toEqual([]);
  });

  it("is named nowhere in the source", async () => {
    const root = join(import.meta.dirname, "../../../../src");
    const files = (await sourcesUnder(root)).filter((file) => {
      return !file.startsWith(STATIC_DOCS);
    });
    const found = await Promise.all(
      files.map(async (file) => {
        return scopedCommandsNamedIn(await readFile(join(root, file), "utf8")).map((line) => {
          return `${file}:${line}`;
        });
      }),
    );

    expect(files.length).toBeGreaterThan(0);
    expect(found.flat().sort()).toEqual([]);
  });
});
