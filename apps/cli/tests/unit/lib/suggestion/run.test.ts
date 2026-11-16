import { Config } from "@oclif/core";
import { describe, expect, it } from "vitest";

import { isSecretFlag } from "@/lib/secret-key";
import { declaredOf, type Declared } from "@/lib/suggestion";
import { type ParsedToken, RunSuggestions } from "@/lib/suggestion/run";
import { cliPackageRoot } from "@tests/helpers/oclif-build";

/** A value that must never reach a suggestion, whatever it was typed as. */
const CANARY = "s3cr3t-canary-7f3a";

const config = await Config.load(cliPackageRoot);

const run = new RunSuggestions({
  findCommand: (id: string) => {
    return config.findCommand(id);
  },
  cliVersion: () => {
    return "0.1.0";
  },
  scope: () => {
    return {};
  },
});

/** The assignment flags of a command: each takes `name=value` or `path:=json`. */
const ASSIGNMENT_FLAGS = ["set", "field"];

/** The flags that take a whole JSON document. */
const DOCUMENT_FLAGS = ["data"];

const COMMANDS: readonly [string, Declared][] = config.commands
  .filter((command) => {
    return !command.hidden || command.id.includes(":");
  })
  .map((command): [string, Declared] => {
    return [command.id, declaredOf(command.id, config.findCommand(command.id))];
  });

/**
 * The command again, as a run of `id` typed `raw`.
 *
 * @param id - The command.
 * @param target - What it declares.
 * @param raw - Its command line as oclif parsed it.
 * @returns What a rerun of it prints.
 */
const printed = (id: string, target: Declared, raw: readonly ParsedToken[]): string => {
  return run.rerun(id, target, raw);
};

/** Every case: a command, what is typed to it, and what the table calls it. */
const CASES: readonly [string, Declared, readonly ParsedToken[]][] = COMMANDS.flatMap(
  ([id, target]) => {
    const flags = [...target.flags].filter(([, flag]) => {
      return flag.type === "option";
    });
    // What every run of the command is given: its required arguments.
    const given: ParsedToken[] = (target.requiredArgs ?? []).map((): ParsedToken => {
      return { type: "arg", input: "given_1" };
    });
    return [
      ...flags
        .filter(([name]) => {
          return isSecretFlag(name);
        })
        .map(([name]): [string, Declared, readonly ParsedToken[]] => {
          return [
            `${id} --${name}`,
            target,
            [...given, { type: "flag", flag: name, input: CANARY }],
          ];
        }),
      ...flags
        .filter(([name]) => {
          return ASSIGNMENT_FLAGS.includes(name);
        })
        .map(([name]): [string, Declared, readonly ParsedToken[]] => {
          return [
            `${id} --${name} attributes.password=…`,
            target,
            [...given, { type: "flag", flag: name, input: `attributes.password=${CANARY}` }],
          ];
        }),
      ...flags
        .filter(([name]) => {
          return DOCUMENT_FLAGS.includes(name);
        })
        .map(([name]): [string, Declared, readonly ParsedToken[]] => {
          return [
            `${id} --${name} '{"…":{"client_secret":…}}'`,
            target,
            [
              ...given,
              { type: "flag", flag: name, input: `{"idp":{"client_secret":"${CANARY}"}}` },
            ],
          ];
        }),
      ...target.args
        .filter((name) => {
          return isSecretFlag(name);
        })
        .map((name): [string, Declared, readonly ParsedToken[]] => {
          const at = target.args.indexOf(name);
          return [
            `${id} <${name}>`,
            target,
            target.args.slice(0, at + 1).map((_arg, index): ParsedToken => {
              return { type: "arg", input: index === at ? CANARY : "given_1" };
            }),
          ];
        }),
    ];
  },
);

describe("RunSuggestions#rerun", () => {
  it("is exercised for every kind of secret a command can be typed", () => {
    const kinds = new Set(
      CASES.map(([label]) => {
        return label.includes("attributes.password")
          ? "assignment"
          : label.includes("client_secret")
            ? "document"
            : label.includes("<")
              ? "argument"
              : "flag";
      }),
    );

    expect([...kinds].sort()).toEqual(["assignment", "document", "flag"]);
  });

  it.each(CASES)("never prints a secret typed to %s", (_label, target, raw) => {
    const id = _label.split(" ")[0] ?? "";

    expect(printed(id, target, raw)).not.toContain(CANARY);
  });

  it("keeps the words of a flag that holds no secret", () => {
    const target = declaredOf("deploy", config.findCommand("deploy"));

    expect(
      printed("deploy", target, [{ type: "flag", flag: "message", input: "ship it" }]),
    ).toContain("--message 'ship it'");
  });
});
