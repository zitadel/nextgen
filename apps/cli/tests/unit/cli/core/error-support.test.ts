import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Command, Config } from "@oclif/core";
import ts from "typescript";
import { describe, expect } from "vitest";

import { ErrorSupport } from "@/cli/core/error-support";
import { WORDINGS } from "@/cli/core/error-support/index";
import { BackendTimeoutError } from "@/lib/backend";
import { EnvironmentValueMissingError } from "@/lib/environment";
import { ZitadelError } from "@/lib/errors";
import { ProjectConfigMissingError } from "@/lib/project";
import { LocalServerBusyError, LocalServerRecordMalformedError } from "@/lib/server";
import { it } from "@tests/fixtures";
import { nodesOf, parsedFile, sourcesUnder } from "@tests/helpers/declarations";
import { cliPackageRoot } from "@tests/helpers/oclif-build";

const lib = fileURLToPath(new URL("../../../../src/lib", import.meta.url));

/**
 * The lib errors that have no wording, each with why: a bug in the CLI's own
 * code, which is not a refusal to word, or an error that never leaves the
 * code that raises it.
 */
const UNWORDED: ReadonlyMap<string, string> = new Map([
  ["GitInternalError", "a bug in the git package, never a refusal"],
  ["ConsentInternalError", "a bug in the consent package, never a refusal"],
  ["ZitadelConfigInternalError", "a bug in the configuration library, never a refusal"],
  ["WizardDefinitionError", "a wizard built with two steps of one name, a bug in its command"],
  ["SuggestionInvalidError", "a follow-up the code wrote wrong, a bug in its command"],
  ["TelemetryHomeUnknownError", "caught inside telemetry, which never stops a run"],
  ["TelemetryClientError", "caught inside telemetry, which never stops a run"],
  ["PublishAssetTargetUnsafeError", "the asset probe reports it as a warning"],
  ["PublishAssetLookupFailedError", "the asset probe reports it as a warning"],
]);

/**
 * The lib error families worded elsewhere, each with where: every class that
 * extends one is too.
 */
const WORDED_ELSEWHERE: ReadonlyMap<string, string> = new Map([
  ["BackendError", "the server's answer, which toZitadelError words by its status and body"],
]);

/** A class declared under `src/lib`: the class it extends, and whether it is abstract. */
type Declared = Readonly<{
  parent: string | undefined;
  abstract: boolean;
}>;

/**
 * Every class declared under `src/lib`, by name.
 *
 * @returns The classes.
 */
async function libClasses(): Promise<ReadonlyMap<string, Declared>> {
  const found = new Map<string, Declared>();
  for (const file of await sourcesUnder(lib)) {
    const source = await parsedFile(join(lib, file));
    for (const declaration of nodesOf(source, ts.isClassDeclaration)) {
      if (declaration.name === undefined) {
        continue;
      }
      const extended = declaration.heritageClauses
        ?.find((clause) => {
          return clause.token === ts.SyntaxKind.ExtendsKeyword;
        })
        ?.types.at(0)?.expression;
      found.set(declaration.name.text, {
        parent: extended !== undefined && ts.isIdentifier(extended) ? extended.text : undefined,
        abstract: (ts.getCombinedModifierFlags(declaration) & ts.ModifierFlags.Abstract) !== 0,
      });
    }
  }
  return found;
}

/**
 * `name` and every class it extends under `src/lib`, nearest first.
 *
 * @param classes - The classes under `src/lib`.
 * @param name - The class.
 * @returns The chain.
 */
function chainOf(classes: ReadonlyMap<string, Declared>, name: string | undefined): string[] {
  const declared = name === undefined ? undefined : classes.get(name);
  if (name === undefined || declared === undefined) {
    return [];
  }
  return [name, ...chainOf(classes, declared.parent)];
}

/** A command that only exposes what the mixin gives it. */
class Wording extends ErrorSupport(Command) {
  /**
   * Does nothing, as a command that only words errors.
   */
  public async run(): Promise<void> {}

  /**
   * Words what a command threw.
   *
   * @param error - What it threw.
   * @param cwd - The folder the run acts on.
   * @returns What the run reports.
   */
  public wording(error: unknown, cwd: string): unknown {
    return this.worded(error, cwd);
  }
}

/**
 * A command with the error support, built against the CLI's own config.
 *
 * @returns The command.
 */
async function aWordingCommand(): Promise<Wording> {
  return new Wording([], await Config.load(cliPackageRoot));
}

/** The folder a test's run acts on. */
const CWD = "/work/app";

describe("ErrorSupport", () => {
  it("words every lib error a command can let through", async () => {
    const classes = await libClasses();
    const worded = new Set(
      WORDINGS.map(([Class]) => {
        return Class.name;
      }),
    );

    const unworded = [...classes.entries()].flatMap(([name, declared]) => {
      const chain = chainOf(classes, name);
      if (declared.abstract || !chain.includes("ZitadelLibError") || UNWORDED.has(name)) {
        return [];
      }
      return chain.some((one) => {
        return worded.has(one) || WORDED_ELSEWHERE.has(one);
      })
        ? []
        : [name];
    });

    expect(unworded).toEqual([]);
  });

  it("allows only classes that exist", async () => {
    const classes = await libClasses();

    const unknown = [...UNWORDED.keys(), ...WORDED_ELSEWHERE.keys()].filter((name) => {
      return !classes.has(name);
    });

    expect(unknown).toEqual([]);
  });

  describe("with a lib error that has a wording", () => {
    it("says its message, hint and next commands", async () => {
      const command = await aWordingCommand();

      const reported = command.wording(
        new ProjectConfigMissingError("zitadel.json was not found"),
        CWD,
      );

      expect(reported).toMatchObject({
        code: "E_VALIDATION",
        message: "zitadel.json was not found",
        hint: "Set the project up first.",
        nextCommands: [{ id: "setup" }],
      });
    });

    it("keeps the code the error reports", async () => {
      const command = await aWordingCommand();

      const reported = command.wording(
        new LocalServerBusyError("Another start is running", "/work/app/.zitadel/start.lock", 42),
        CWD,
      );

      expect(reported).toMatchObject({ code: "E_CONFLICT" });
    });

    it("reports the error's own fields as details, keyed in snake_case", async () => {
      const command = await aWordingCommand();

      const reported = command.wording(
        new LocalServerBusyError("Another start is running", "/work/app/.zitadel/start.lock", 42),
        CWD,
      );

      expect(reported).toMatchObject({
        details: { lock_file: "/work/app/.zitadel/start.lock", owner_pid: 42 },
      });
    });

    it("fills its hint from what it works out of the error", async () => {
      const command = await aWordingCommand();

      const reported = command.wording(
        new EnvironmentValueMissingError("ZITADEL_URL is not set for the ci environment", {
          environment: "ci",
          variable: "ZITADEL_URL",
          consulted: ["process environment", ".env.ci.local"],
          file: ".env.ci.local",
        }),
        CWD,
      );

      expect(reported).toMatchObject({
        hint: "Consulted, in order: process environment, .env.ci.local. Set ZITADEL_URL in .env.ci.local or the process environment.",
      });
    });

    it.each([
      [
        "the folder the run acts on",
        CWD,
        [
          { id: "reset", flags: { force: true } },
          { id: "start", flags: {} },
        ],
      ],
      [
        "another folder",
        "/work",
        [
          { id: "reset", flags: { force: true, cwd: "/work" } },
          { id: "start", flags: { cwd: "/work" } },
        ],
      ],
    ] as const)("aims its follow-ups at a record held in %s", async (_where, directory, next) => {
      const command = await aWordingCommand();

      const reported = command.wording(
        new LocalServerRecordMalformedError(".zitadel/local/runtime.json is malformed", directory),
        CWD,
      );

      expect(reported).toMatchObject({ nextCommands: next });
    });

    it("is a refusal the run reports", async () => {
      const command = await aWordingCommand();

      const reported = command.wording(
        new ProjectConfigMissingError("zitadel.json was not found"),
        CWD,
      );

      expect(reported).toBeInstanceOf(ZitadelError);
    });
  });

  describe("with an error it has no wording for", () => {
    it.each([
      ["the server's answer", new BackendTimeoutError("timed out")],
      ["an error nobody anticipated", new TypeError("boom")],
    ] as const)("leaves %s as it was thrown", async (_what, error) => {
      const command = await aWordingCommand();

      const reported = command.wording(error, CWD);

      expect(reported).toBe(error);
    });
  });
});
