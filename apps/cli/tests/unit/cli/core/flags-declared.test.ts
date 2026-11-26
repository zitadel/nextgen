import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Interfaces } from "@oclif/core";
import { Config } from "@oclif/core";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import {
  callsOf,
  declaredAs,
  identifiersIn,
  nodesOf,
  parsedFile,
  sourcesUnder,
} from "@tests/helpers/declarations";

import { COMMANDS, WORKFLOW_COMMANDS } from "@/index";
import { cliPackageRoot } from "@tests/helpers/oclif-build";
import { relationsOf } from "@/lib/suggestion/relations";

const commands = fileURLToPath(new URL("../../../../src/cli/commands", import.meta.url));

/**
 * The ways a flag's refusal is raised by the flag itself: the `parse` it gives
 * `Flags.custom`/`Args.custom`, or a command's own wrapper around one.
 */
const RAISED_BY_THE_FLAG = ["reads", "taken", "readsFilled"];

/**
 * What a command declares and what its class does with it. The class is the
 * run: a flag is declared in it, and everything it does once the run starts
 * happens in it too. The module around it holds the refusals, the schemas and
 * the readers a prompt shares with a flag.
 */
type Command = Readonly<{ file: string; refused: string[]; run: ts.ClassDeclaration }>;

/**
 * Every command under `src/cli/commands` that declares a `Refused`, with its class.
 *
 * @returns The commands.
 */
async function declared(): Promise<Command[]> {
  const found: Command[] = [];
  for (const file of await sourcesUnder(commands)) {
    const source = await parsedFile(join(commands, file));
    const refused = declaredAs(source, "Refused").map((declaration) => {
      return declaration.name;
    });
    const run = nodesOf(source, ts.isClassDeclaration).find((declaration) => {
      return (
        declaration.modifiers?.some((modifier) => {
          return modifier.kind === ts.SyntaxKind.DefaultKeyword;
        }) === true
      );
    });
    if (refused.length === 0 || run === undefined) {
      continue;
    }
    found.push({ file, refused, run });
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
      const named = identifiersIn(command.run);
      const applied = callsOf(command.run, RAISED_BY_THE_FLAG).flatMap((call) => {
        const first = call.arguments[0];
        return first !== undefined && ts.isIdentifier(first) ? [first.text] : [];
      });
      return command.refused
        .filter((name) => {
          return (
            named.filter((one) => one === name).length >
            applied.filter((one) => one === name).length
          );
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
          ...((flag.relationships?.length ?? 0) > 0 && relation?.excludedWhen === undefined
            ? ["relationships"]
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

describe("what a flag's relations name", () => {
  it.each(Object.entries(COMMANDS))("%s names only flags it declares", (_id, command) => {
    const flags = { ...command.baseFlags, ...command.flags } as Record<
      string,
      Interfaces.Flag<unknown>
    >;
    const named = Object.entries(flags).flatMap(([name, flag]) => {
      return [
        ...(flag.exclusive ?? []),
        ...(flag.dependsOn ?? []),
        ...(flag.relationships ?? []).flatMap((relationship) => {
          return relationship.flags.map((other) => {
            return typeof other === "string" ? other : other.name;
          });
        }),
      ].map((other) => {
        return { name, other };
      });
    });
    const unknown = named.filter(({ other }) => {
      return !(other in flags) && other !== "json";
    });

    expect(unknown).toEqual([]);
  });
});

describe("what every command takes by what it does", () => {
  it.each(Object.entries(COMMANDS))(
    "%s takes --dry-run exactly when it says what it would do",
    (_id, command) => {
      const previews = "preview" in command.prototype && "apply" in command.prototype;

      expect("dry-run" in (command.baseFlags ?? {})).toBe(previews);
    },
  );

  it.each(Object.entries(COMMANDS))(
    "%s declares --dry-run through Previewable alone, never in flags of its own",
    (_id, command) => {
      expect("dry-run" in (command.flags ?? {})).toBe(false);
    },
  );

  it.each(Object.entries(COMMANDS))(
    "%s leaves its work to preview and apply, never to an execute of its own",
    (_id, command) => {
      if ("preview" in command.prototype) {
        expect(Object.hasOwn(command.prototype, "execute")).toBe(false);
      }
    },
  );

  it.each(Object.entries(COMMANDS))(
    "%s takes --force from the mixin that asks consent, or declares a meaning of its own",
    (_id, command) => {
      const asks = "confirmed" in command.prototype;

      if (asks) {
        expect(command.baseFlags).toHaveProperty("force");
      }
    },
  );
});

describe("what oclif lists of every command", () => {
  it("includes --json for every command that takes it", async () => {
    const config = await Config.load(cliPackageRoot);
    const without = config.commands
      .filter((command) => {
        return command.id in COMMANDS && command.hidden !== true && !("json" in command.flags);
      })
      .map((command) => {
        return command.id;
      });

    expect(without).toEqual([]);
  });
});
