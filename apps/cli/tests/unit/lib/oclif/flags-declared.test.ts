import { readFile, readdir } from "node:fs/promises";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";

import type { Interfaces } from "@oclif/core";
import { describe, expect, it } from "vitest";

import { WORKFLOW_COMMANDS } from "@/index";
import { relationsOf } from "@/lib/oclif/flags";

const commands = fileURLToPath(new URL("../../../../src/commands", import.meta.url));

/** A `const NAME: Refused<T>` — what one flag or argument is refused for. */
const REFUSED = /const (\w+): Refused<[^>]*> = \{/g;

/**
 * The ways a flag's refusal is raised by the flag itself: the `parse` it gives
 * `Flags.custom`/`Args.custom`, or a command's own wrapper around one.
 */
const RAISED_BY_THE_FLAG = /\b(?:reads|taken|readsFilled)\(\s*(\w+)/g;

/** Where a command's class begins: everything after it runs, nothing before it does. */
const CLASS = /^export default class /m;

/**
 * `source` with its comments and its strings taken out, so a flag's name
 * counts where the code names it and not where the prose beside it happens to
 * use the same word.
 */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/"[^"\n]*"|'[^'\n]*'|`[^`]*`/g, '""');
}

/** Every `.ts` file under `src/commands`, as a path relative to it. */
async function files(): Promise<string[]> {
  const found = await readdir(commands, { recursive: true });
  return found.filter((file) => file.endsWith(".ts")).map((file) => file.split(sep).join("/"));
}

/**
 * What a command declares and what its class does with it. The class is the
 * run: a flag is declared in it, and everything it does once the run starts
 * happens in it too. The module around it holds the refusals, the schemas and
 * the readers a prompt shares with a flag.
 */
type Command = Readonly<{ file: string; refused: string[]; body: string }>;

async function declared(): Promise<Command[]> {
  const found: Command[] = [];
  for (const file of await files()) {
    const source = await readFile(join(commands, file), "utf8");
    const refused = [...source.matchAll(REFUSED)].map((match) => match[1] as string);
    const at = CLASS.exec(source)?.index;
    if (refused.length === 0 || at === undefined) {
      continue;
    }
    found.push({ file, refused, body: code(source.slice(at)) });
  }
  return found;
}

/**
 * A `Refused` names a flag's own rule, and `reads` is how the flag applies it:
 * refusing during parse puts the refusal where oclif's own lands, so a value
 * reaching the command has been admitted. A class that names a `Refused`
 * anywhere else has taken the rule back — checking a value it was handed,
 * raising the flag's refusal from the run, or parsing the value a second time
 * — which is the thing this lifecycle exists to stop, and which reads as
 * ordinary code until someone remembers the rule.
 *
 * The module around the class may name one freely: that is where the schema is
 * built, and where a reader a prompt shares with its flag lives
 * (`readPort`, `readAppUrl`), so a value typed at a prompt is held to the rule
 * the flag applies.
 */
describe("what a flag is refused for", () => {
  it("is applied by the flag, and nowhere else in the command", async () => {
    const taken = (await declared()).flatMap((command) => {
      const applied = [...command.body.matchAll(RAISED_BY_THE_FLAG)].map(
        (match) => match[1] as string,
      );
      return command.refused
        .filter((name) => {
          const named = [...command.body.matchAll(new RegExp(`\\b${name}\\b`, "g"))];
          return named.length > applied.filter((one) => one === name).length;
        })
        .map((name) => `${command.file}: ${name}`);
    });

    expect(taken).toEqual([]);
  });
});

describe("what a flag requires of the others", () => {
  it("is declared through relatedFlags, so a suggested command is checked against it", () => {
    // The generated resource commands are typed loosely, so the renderer checks
    // their relations when it renders one; only a hand-written command has types
    // to carry them.
    const inline = Object.entries(WORKFLOW_COMMANDS).flatMap(([id, command]) => {
      const flags = (command.flags ?? {}) as Record<string, Interfaces.Flag<unknown>>;
      const related = relationsOf(flags);
      return Object.entries(flags).flatMap(([name, flag]) => {
        const relation = related[name];
        const kinds = [
          ...(flag.required === true && relation?.required !== true ? ["required"] : []),
          ...((flag.exclusive?.length ?? 0) > 0 && relation?.exclusive === undefined
            ? ["exclusive"]
            : []),
          ...((flag.dependsOn?.length ?? 0) > 0 && relation?.dependsOn === undefined
            ? ["dependsOn"]
            : []),
        ];
        return kinds.map((kind) => {
          return `${id} --${name} ${kind}`;
        });
      });
    });

    expect(inline).toEqual([]);
  });
});
