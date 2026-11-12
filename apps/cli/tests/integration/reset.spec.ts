import { describe, expect, it } from "vitest";

import { useLocalServers } from "@tests/helpers/local-server";
import { usePlatformMock } from "@tests/helpers/platform";
import { anApp, aSetUpApp } from "@tests/helpers/project";
import { cliVersion, expectedPublicCliCommand } from "@tests/helpers/run-cli";
import { asTerminal, offTerminal, onTerminalReadingAFile } from "@tests/helpers/terminal";

const platform = usePlatformMock();
useLocalServers();

const CLI_VERSION = cliVersion.version;

/** The two ways a person reads a run, which must say the same thing. */
const SHOWN = [
  ["on a terminal", asTerminal],
  ["piped", offTerminal],
] as const;

/** The two ways a person reads a refusal, which cannot be asked anything. */
const REFUSED = [
  ["on a terminal reading a file", onTerminalReadingAFile],
  ["piped", offTerminal],
] as const;

describe("reset", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("still succeeds", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.run(["reset", "--force", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: CLI_VERSION,
          command: "reset",
          source: "http://localhost:8080",
          data: {
            title: "Local Zitadel server runtime reset",
            runtime: {
              backend: "missing",
              container_name: expect.stringMatching(/^zitadel-server-[0-9a-f]{12}$/),
              data_deleted: true,
            },
          },
          warnings: [],
        });
      });
    });

    describe("that is down", () => {
      it("still succeeds", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.run(["reset", "--force", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: CLI_VERSION,
          command: "reset",
          source: "http://localhost:8080",
          data: {
            title: "Local Zitadel server runtime reset",
            runtime: {
              backend: "missing",
              container_name: expect.stringMatching(/^zitadel-server-[0-9a-f]{12}$/),
              data_deleted: true,
            },
          },
          warnings: [],
        });
      });
    });

    describe("that refuses connections", () => {
      it("still succeeds", async () => {
        const app = await aSetUpApp();
        platform.refusesConnections();

        const result = await app.run(["reset", "--force", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: CLI_VERSION,
          command: "reset",
          source: "http://localhost:8080",
          data: {
            title: "Local Zitadel server runtime reset",
            runtime: {
              backend: "missing",
              container_name: expect.stringMatching(/^zitadel-server-[0-9a-f]{12}$/),
              data_deleted: true,
            },
          },
          warnings: [],
        });
      });
    });
  });

  describe("against a valid server", () => {
    it("holds its invariants in every rendering", async () => {
      const app = await aSetUpApp();
      const args = ["reset", "--force"];

      await app.inEveryRendering((how) => app.run(how.json ? [...args, "--json"] : args, how.env));
    });

    describe("--json", () => {
      it("refuses without --force when no one can be asked, deleting nothing", async () => {
        const app = await aSetUpApp();
        const before = await app.snapshot();

        const result = await app.run(["reset", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: CLI_VERSION,
          command: "reset",
          source: "http://localhost:8080",
          code: "E_CONFIRMATION_REQUIRED",
          message:
            "Cannot delete the local runtime and its data without --force in non-interactive mode",
          hint: `Ask a person first: Permanently delete the local Zitadel server's data in ${app.path}/.zitadel/local/nextgen-data?\n\nIt stops and removes the local server if one is running, so the status command no longer reports it.\nIt deletes the server's database: every organization, user, application and setting you created. This cannot be undone.\nKept: ${app.path}/.zitadel/local/admin.json, the local admin sign-in, and everything else in your project.\nRun ${expectedPublicCliCommand(`start --cwd ${app.path}`)} afterwards to set up a fresh server. Pass --force only once they agree.`,
          next_commands: [expectedPublicCliCommand(app.againAsRun("reset --force"))],
          details: {
            question: `Permanently delete the local Zitadel server's data in ${app.path}/.zitadel/local/nextgen-data?\n\nIt stops and removes the local server if one is running, so the status command no longer reports it.\nIt deletes the server's database: every organization, user, application and setting you created. This cannot be undone.\nKept: ${app.path}/.zitadel/local/admin.json, the local admin sign-in, and everything else in your project.\nRun ${expectedPublicCliCommand(`start --cwd ${app.path}`)} afterwards to set up a fresh server.`,
          },
        });
        expect(await before.changes()).toMatchObject({ added: [], modified: [], removed: [] });
      });

      it("deletes a running server's runtime and says which process it was", async () => {
        const app = await aSetUpApp();
        const started = await app.startLocalServer();

        const result = await app.run(["reset", "--force", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: CLI_VERSION,
          command: "reset",
          source: `http://localhost:${app.localPortOf(started)}`,
          data: {
            title: "Local Zitadel server runtime reset",
            runtime: {
              backend: "binary",
              pid: app.localPidOf(started),
              log_path: `${app.path}/.zitadel/local/server.log`,
              data_deleted: true,
            },
          },
          warnings: [],
        });
      });

      it("succeeds when there is no local runtime to delete", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["reset", "--force", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: CLI_VERSION,
          command: "reset",
          source: "http://localhost:8080",
          data: {
            title: "Local Zitadel server runtime reset",
            runtime: {
              backend: "missing",
              container_name: expect.stringMatching(/^zitadel-server-[0-9a-f]{12}$/),
              data_deleted: true,
            },
          },
          warnings: [],
        });
      });

      it("succeeds in a directory that was never set up", async () => {
        const app = await anApp();

        const result = await app.run(["reset", "--force", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: CLI_VERSION,
          command: "reset",
          source: "http://localhost:8080",
          data: {
            title: "Local Zitadel server runtime reset",
            runtime: {
              backend: "missing",
              container_name: expect.stringMatching(/^zitadel-server-[0-9a-f]{12}$/),
              data_deleted: true,
            },
          },
          warnings: [],
        });
      });

      it("leaves the project's committed configuration alone", async () => {
        const app = await aSetUpApp();
        const before = await app.snapshot();

        const result = await app.run(["reset", "--force", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: CLI_VERSION,
          command: "reset",
          source: "http://localhost:8080",
          data: {
            title: "Local Zitadel server runtime reset",
            runtime: {
              backend: "missing",
              container_name: expect.stringMatching(/^zitadel-server-[0-9a-f]{12}$/),
              data_deleted: true,
            },
          },
          warnings: [],
        });
        const { removed } = await before.changes();
        expect(removed).not.toContain("zitadel.json");
        expect(removed).not.toContain(".zitadel/schemas/default-human-user.json");
      });

      it("plans the reset without claiming the data was deleted", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["reset", "--dry-run", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: CLI_VERSION,
          command: "reset",
          source: "http://localhost:8080",
          data: {
            dry_run: true,
            title: "Would reset the local Zitadel server runtime (dry run)",
            runtime: {
              backend: "missing",
              container_name: expect.stringMatching(/^zitadel-server-[0-9a-f]{12}$/),
              data_deleted: false,
            },
            next_commands: [expectedPublicCliCommand(`reset --force --cwd ${app.path}`)],
          },
          warnings: [],
        });
      });

      it("plans the reset of a running server and leaves it running", async () => {
        const app = await aSetUpApp();
        const started = await app.startLocalServer();

        const result = await app.run(["reset", "--dry-run", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: CLI_VERSION,
          command: "reset",
          source: `http://localhost:${app.localPortOf(started)}`,
          data: {
            dry_run: true,
            title: "Would reset the local Zitadel server runtime (dry run)",
            runtime: {
              backend: "binary",
              pid: app.localPidOf(started),
              log_path: `${app.path}/.zitadel/local/server.log`,
              data_deleted: false,
            },
            next_commands: [expectedPublicCliCommand(`reset --force --cwd ${app.path}`)],
          },
          warnings: [],
        });
        expect(await app.localServerLifecycle()).toBe("running");
      });
    });

    describe.each(SHOWN)("rendered %s", (_how, shown) => {
      it("titles the reset as --json does", async () => {
        const app = await aSetUpApp();

        const result = await shown(() => app.run(["reset", "--force"]));

        expect(result).toSayOnce("Local Zitadel server runtime reset");
      });

      it("names the process it reset", async () => {
        const app = await aSetUpApp();
        const started = await app.startLocalServer();

        const result = await shown(() => app.run(["reset", "--force"]));

        expect(result).toPrintRow("Process", String(app.localPidOf(started)));
      });

      it("titles a dry run as --json does, ending in (dry run)", async () => {
        const app = await aSetUpApp();

        const result = await shown(() => app.run(["reset", "--dry-run"]));

        expect(result).toSayOnce("Would reset the local Zitadel server runtime (dry run)");
      });

      it("names the process it would reset", async () => {
        const app = await aSetUpApp();
        const started = await app.startLocalServer();

        const result = await shown(() => app.run(["reset", "--dry-run"]));

        expect(result).toPrintRow("Process", String(app.localPidOf(started)));
      });

      it("prints the reset it planned, once", async () => {
        const app = await aSetUpApp();

        const result = await shown(() => app.run(["reset", "--dry-run"]));

        expect(result).toSayOnce(expectedPublicCliCommand(`reset --force --cwd ${app.path}`));
      });
    });

    describe.each(REFUSED)("refused %s", (_how, shown) => {
      it("says it needs --force, once", async () => {
        const app = await aSetUpApp();

        const result = await shown(() => app.run(["reset"]));

        expect(result).toSayOnce(
          "Cannot delete the local runtime and its data without --force in non-interactive mode",
        );
      });

      it("suggests running it again with --force, once", async () => {
        const app = await aSetUpApp();

        const result = await shown(() => app.run(["reset"]));

        expect(result).toSayOnce(expectedPublicCliCommand(app.againAsRun("reset --force")));
      });

      it("prints nothing on stdout", async () => {
        const app = await aSetUpApp();

        const result = await shown(() => app.run(["reset"]));

        expect(result.stdout).toBe("");
      });
    });
  });
});
