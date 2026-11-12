import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import { anApp, MOCK_SERVER_URL } from "@tests/helpers/project";
import {
  cliVersion,
  expectedPublicCliCommand,
  parseJson,
  runCliForTest,
} from "@tests/helpers/run-cli";
import { asTerminal, offTerminal } from "@tests/helpers/terminal";

const platform = usePlatformMock();

/** `"auth-method sso enable --flag"` and `"auth-method:sso:enable"` name the same id. */
function commandIdFromArgs(args: string): string | undefined {
  const words: string[] = [];
  for (const token of args.trim().split(/\s+/)) {
    if (!/^[a-z][\w:-]*$/.test(token)) break;
    words.push(token);
  }
  return words.length > 0 ? words.join(":") : undefined;
}

async function typescriptFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await typescriptFiles(path)));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(path);
    }
  }
  return files;
}

/** Every command id the source suggests through `publicCliCommand` or copy. */
async function suggestedCommandIds(): Promise<Set<string>> {
  const commands = new Set<string>();
  for (const file of await typescriptFiles(join(import.meta.dirname, "../../src"))) {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(/publicCliCommand\(\s*(["`])([^"`$]*)/g)) {
      const id = commandIdFromArgs(match[2]!);
      if (id) commands.add(id);
    }
    for (const match of source.matchAll(/["`]zitadel\s+([^"`$]*)/g)) {
      const id = commandIdFromArgs(match[1] ?? "");
      if (id) commands.add(id);
    }
  }
  return commands;
}

/**
 * What a project's environment lacks when a deploy runs before setup, as the
 * envelope says it.
 */
const CONSULTED = [
  "--server",
  "process environment",
  ".env.development.local",
  ".env.local",
  ".env.development",
  ".env",
  ".zitadel/secret",
];

/**
 * How the refusal tells the developer to give the project an id.
 */
const NOT_SET_UP_HINT = `Consulted, in order: ${CONSULTED.join(", ")}. Set ZITADEL_PROJECT_ID in .env.development.local or the process environment, or run ${expectedPublicCliCommand("env add development")}.`;

/**
 * What the envelope says of a directory with no local server started in it.
 */
const NO_LOCAL_SERVER = {
  lifecycle: "missing",
  runtime: { configured: false },
  docker: { available: true, container_exists: false, container_running: false },
  health: { healthy: false },
};

describe("the cli", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("fails", async () => {
        const app = await anApp();
        platform.isNotZitadel();

        const result = await app.deploy();

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "deploy",
          source: MOCK_SERVER_URL,
          code: "E_VALIDATION",
          message: "ZITADEL_PROJECT_ID is not set for the development environment",
          hint: NOT_SET_UP_HINT,
          next_commands: [expectedPublicCliCommand(`setup --cwd ${app.path}`)],
          details: {
            environment: "development",
            variable: "ZITADEL_PROJECT_ID",
            consulted: CONSULTED,
          },
        });
      });
    });

    describe("that is down", () => {
      it("fails", async () => {
        const app = await anApp();
        platform.isUnavailable();

        const result = await app.deploy();

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "deploy",
          source: MOCK_SERVER_URL,
          code: "E_VALIDATION",
          message: "ZITADEL_PROJECT_ID is not set for the development environment",
          hint: NOT_SET_UP_HINT,
          next_commands: [expectedPublicCliCommand(`setup --cwd ${app.path}`)],
          details: {
            environment: "development",
            variable: "ZITADEL_PROJECT_ID",
            consulted: CONSULTED,
          },
        });
      });
    });

    describe("that refuses connections", () => {
      it("fails", async () => {
        const app = await anApp();
        platform.refusesConnections();

        const result = await app.deploy();

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "deploy",
          source: MOCK_SERVER_URL,
          code: "E_VALIDATION",
          message: "ZITADEL_PROJECT_ID is not set for the development environment",
          hint: NOT_SET_UP_HINT,
          next_commands: [expectedPublicCliCommand(`setup --cwd ${app.path}`)],
          details: {
            environment: "development",
            variable: "ZITADEL_PROJECT_ID",
            consulted: CONSULTED,
          },
        });
      });
    });
  });

  describe("against a valid server", () => {
    describe("--json", () => {
      it("names the failure when run before setup", async () => {
        const app = await anApp();

        const result = await app.deploy();

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "deploy",
          source: MOCK_SERVER_URL,
          code: "E_VALIDATION",
          message: "ZITADEL_PROJECT_ID is not set for the development environment",
          hint: NOT_SET_UP_HINT,
          next_commands: [expectedPublicCliCommand(`setup --cwd ${app.path}`)],
          details: {
            environment: "development",
            variable: "ZITADEL_PROJECT_ID",
            consulted: CONSULTED,
          },
        });
      });

      it("exits as a validation failure does", async () => {
        const app = await anApp();

        const result = await app.deploy();

        expect(result).toFailWith("E_VALIDATION");
      });

      it("points at setup as the way out", async () => {
        const app = await anApp();

        const result = await app.deploy();

        expect(result).toSuggestExactly(`setup --cwd ${app.path}`);
      });

      it("has no server of its own when nothing names one", async () => {
        const app = await anApp();

        const result = await app.runWithoutServer(["status", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "status",
          source: "",
          status: "ok",
          data: {
            title: "Checked the status of the project",
            server: NO_LOCAL_SERVER,
            project: {
              lifecycle: "not-configured",
              message: "zitadel.json has not been created yet.",
            },
            next_actions: [
              "From your app directory, run setup; the CLI will detect the framework or ask in an empty directory.",
            ],
            next_commands: [
              expectedPublicCliCommand(`start --cwd ${app.path}`),
              expectedPublicCliCommand(`setup --server local --cwd ${app.path}`),
            ],
          },
          warnings: [],
        });
      });

      it("takes the server from ZITADEL_URL in the project's env file", async () => {
        const app = await anApp();
        await app.bindEnvironment("development", {
          ZITADEL_URL: "https://self.example",
          ZITADEL_PROJECT_ID: "existing",
        });

        const result = await app.runWithoutServer(["status", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "status",
          source: "https://self.example",
          status: "ok",
          data: {
            title: "Checked the status of the project",
            server: NO_LOCAL_SERVER,
            project: {
              lifecycle: "not-configured",
              message: "zitadel.json has not been created yet.",
            },
            next_actions: [
              "From your app directory, run setup; the CLI will detect the framework or ask in an empty directory.",
            ],
            next_commands: [
              expectedPublicCliCommand(`start --cwd ${app.path}`),
              expectedPublicCliCommand(`setup --server local --cwd ${app.path}`),
            ],
          },
          warnings: [],
        });
      });

      it("ignores the server named in zitadel.json", async () => {
        const app = await anApp();
        await app.writeConfig({
          $schema: "./.zitadel/meta/project.json",
          project: "existing",
          server: "https://self.example",
        });

        const result = await app.runWithoutServer(["status", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "status",
          source: "",
          status: "ok",
          data: {
            title: "Checked the status of the project",
            server: NO_LOCAL_SERVER,
            project: {
              lifecycle: "orphaned-config",
              project_id: "existing",
              message: "zitadel.json exists but .zitadel/secret is missing.",
            },
            next_actions: [],
            next_commands: [
              expectedPublicCliCommand(`start --cwd ${app.path}`),
              expectedPublicCliCommand(`setup --force --cwd ${app.path}`),
              expectedPublicCliCommand(`doctor --fix --cwd ${app.path}`),
            ],
          },
          warnings: [],
        });
      });

      it("only ever suggests commands a user can run", async () => {
        const listed = await runCliForTest(["commands", "--json"]);
        expect(listed).toSucceed();
        const visible = new Set(
          (parseJson(listed.stdout) as Array<{ id?: unknown }>)
            .map((command) => command.id)
            .filter((id): id is string => typeof id === "string"),
        );

        const suggested = await suggestedCommandIds();

        expect([...suggested].sort()).toEqual(
          expect.arrayContaining(["deploy", "doctor", "setup"]),
        );
        for (const command of suggested) {
          expect(visible, `${command} is suggested but not a visible command`).toContain(command);
        }
      });
    });

    describe("global flags", () => {
      it("accepts -v as the short form of --verbose", async () => {
        const app = await anApp();

        const result = await app.runWithoutServer(["status", "-v", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "status",
          source: "",
          status: "ok",
          data: {
            title: "Checked the status of the project",
            server: NO_LOCAL_SERVER,
            project: {
              lifecycle: "not-configured",
              message: "zitadel.json has not been created yet.",
            },
            next_actions: [
              "From your app directory, run setup; the CLI will detect the framework or ask in an empty directory.",
            ],
            next_commands: [
              expectedPublicCliCommand(`start --cwd ${app.path}`),
              expectedPublicCliCommand(`setup --server local --cwd ${app.path}`),
            ],
          },
          warnings: [],
        });
      });

      it("rejects an unrecognised short flag", async () => {
        const result = await runCliForTest(["resources", "-Z", "--json"]);

        expect(parseJson(result.stdout)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "resources",
          source: "",
          code: "E_VALIDATION",
          message: "Nonexistent flag: -Z",
          next_commands: [expectedPublicCliCommand("resources --help")],
          details: {
            original: {
              name: "Error",
              message: "Nonexistent flag: -Z\nSee more help with --help",
            },
          },
        });
      });

      it("exits as a validation failure does for an unrecognised short flag", async () => {
        const result = await runCliForTest(["resources", "-Z", "--json"]);

        expect(result).toFailWith("E_VALIDATION");
      });

      it.each([["resources"], ["status"], ["logs"]])("accepts -h on %s", async (command) => {
        const result = await runCliForTest([command, "-h"]);

        expect(result).toPrint("USAGE");
      });

      /**
       * Colour itself is not asserted here, and an assertion about it would
       * mislead: picocolors decides colour when it loads, from the
       * real process streams, so a run in this harness emits no escape byte
       * whatever the flags say — a check for their absence would hold against
       * any implementation, broken ones included. What a run decides is pinned
       * in `tests/unit/lib/oclif/base-source.test.ts`, and that no command
       * decides for itself is enforced by `biome-plugins/no-own-colour.grit`.
       */
      it("accepts --no-color", async () => {
        const app = await anApp();

        const result = await app.runWithoutServer(["status", "--no-color", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "status",
          source: "",
          status: "ok",
          data: {
            title: "Checked the status of the project",
            server: NO_LOCAL_SERVER,
            project: {
              lifecycle: "not-configured",
              message: "zitadel.json has not been created yet.",
            },
            next_actions: [
              "From your app directory, run setup; the CLI will detect the framework or ask in an empty directory.",
            ],
            next_commands: [
              expectedPublicCliCommand(`start --cwd ${app.path}`),
              expectedPublicCliCommand(`setup --server local --cwd ${app.path}`),
            ],
          },
          warnings: [],
        });
      });
    });

    describe("for a command that does not exist", () => {
      describe("--json", () => {
        it("prints one error envelope naming the command and the topic's help", async () => {
          const result = await runCliForTest(["teams", "delete", "x", "--json"]);

          expect(parseJson(result.stdout)).toEqual({
            status: "error",
            cli_version: cliVersion.version,
            command: "teams:delete",
            source: "",
            code: "E_VALIDATION",
            message: "teams delete is not a zitadel command.",
            next_commands: [expectedPublicCliCommand("teams --help")],
          });
        });

        it("prints one error envelope with the commands it was close to", async () => {
          const result = await runCliForTest(["variable", "lst", "--json"]);

          expect(parseJson(result.stdout)).toEqual({
            status: "error",
            cli_version: cliVersion.version,
            command: "variable:lst",
            source: "",
            code: "E_VALIDATION",
            message: "variable lst is not a zitadel command.",
            next_commands: [
              expectedPublicCliCommand("variable list --help"),
              expectedPublicCliCommand("variable --help"),
            ],
          });
        });

        it("points at the CLI's help when nothing is close", async () => {
          const result = await runCliForTest(["frobnicate", "--json"]);

          expect(parseJson(result.stdout)).toEqual({
            status: "error",
            cli_version: cliVersion.version,
            command: "frobnicate",
            source: "",
            code: "E_VALIDATION",
            message: "frobnicate is not a zitadel command.",
            next_commands: [expectedPublicCliCommand("--help")],
          });
        });

        it("exits 127, as a shell does for a command it cannot find", async () => {
          const result = await runCliForTest(["teams", "delete", "x", "--json"]);

          expect(result).toExitWith(127);
        });

        it("exits 3 for a word a real command does not take, as its other refusals do", async () => {
          const result = await runCliForTest(["deploy", "extra", "--json"]);

          expect(result).toExitWith(3);
        });

        it("writes nothing to stderr", async () => {
          const result = await runCliForTest(["teams", "delete", "x", "--json"]);

          expect(result.stderr).toBe("");
        });
      });

      describe("piped", () => {
        it("prints the error on stderr and nothing on stdout", async () => {
          const result = await offTerminal(() => runCliForTest(["teams", "delete", "x"]));

          expect(result).toEqual({
            exitCode: 127,
            stdout: "",
            stderr: [
              "Error: teams delete is not a zitadel command. (E_VALIDATION)",
              "",
              "Next:",
              `  $ ${expectedPublicCliCommand("teams --help")}`,
              "",
            ].join("\n"),
          });
        });
      });

      describe("rendered for a terminal", () => {
        it("prints the error and offers no prompt to run another command", async () => {
          const result = await asTerminal(() =>
            runCliForTest(["teams", "delete", "x", "--dry-run"], { NO_COLOR: "1" }),
          );

          expect(result).toEqual({
            exitCode: 127,
            stdout: "",
            stderr: [
              "Error: teams delete is not a zitadel command. (E_VALIDATION)",
              "",
              "Next:",
              `  $ ${expectedPublicCliCommand("teams --help")}`,
              "",
            ].join("\n"),
          });
        });

        it("names the command it was close to as one to type", async () => {
          const result = await asTerminal(() =>
            runCliForTest(["variable", "lst"], { NO_COLOR: "1" }),
          );

          expect(result.stderr).toContain(
            `  $ ${expectedPublicCliCommand("variable list --help")}`,
          );
        });
      });
    });
  });
});
