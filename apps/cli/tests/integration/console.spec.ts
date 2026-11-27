import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import { anApp, aSetUpApp } from "@tests/helpers/project";
import { cliVersion, expectedPublicCliCommand } from "@tests/helpers/run-cli";
import { asTerminal, offTerminal } from "@tests/fixtures/terminal";

const platform = usePlatformMock();

const CLI_VERSION = cliVersion.version;

/** A project whose server is on this machine, so there is no remote console to open instead. */
const ON_THIS_MACHINE = { ZITADEL_URL: "http://localhost:8080" };

/** The two ways a person reads a run, which must say the same thing. */
const SHOWN = [
  ["on a terminal", asTerminal],
  ["piped", offTerminal],
] as const;

describe("console", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("fails because there is no local admin to sign in as", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.runWithoutServer(["console", "--json"], ON_THIS_MACHINE);

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: CLI_VERSION,
          command: "console",
          source: "http://localhost:8080",
          code: "E_VALIDATION",
          message: "No local admin in this directory or its parents",
          hint: "Run this from the directory the local server was started in, or one inside it. If it was never started, start it first; that is what creates the local admin the console signs in as.",
          next_commands: [expectedPublicCliCommand(`start --cwd ${app.path}`)],
        });
      });
    });

    describe("that is down", () => {
      it("fails because there is no local admin to sign in as", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.runWithoutServer(["console", "--json"], ON_THIS_MACHINE);

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: CLI_VERSION,
          command: "console",
          source: "http://localhost:8080",
          code: "E_VALIDATION",
          message: "No local admin in this directory or its parents",
          hint: "Run this from the directory the local server was started in, or one inside it. If it was never started, start it first; that is what creates the local admin the console signs in as.",
          next_commands: [expectedPublicCliCommand(`start --cwd ${app.path}`)],
        });
      });
    });

    describe("that refuses connections", () => {
      it("fails because there is no local admin to sign in as", async () => {
        const app = await aSetUpApp();
        platform.refusesConnections();

        const result = await app.runWithoutServer(["console", "--json"], ON_THIS_MACHINE);

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: CLI_VERSION,
          command: "console",
          source: "http://localhost:8080",
          code: "E_VALIDATION",
          message: "No local admin in this directory or its parents",
          hint: "Run this from the directory the local server was started in, or one inside it. If it was never started, start it first; that is what creates the local admin the console signs in as.",
          next_commands: [expectedPublicCliCommand(`start --cwd ${app.path}`)],
        });
      });
    });
  });

  describe("against a valid server", () => {
    it("holds its invariants in every rendering", async () => {
      const app = await aSetUpApp();

      await app.inEveryRendering((how) =>
        app.runWithoutServer(how.json ? ["console", "--json"] : ["console"], {
          ...how.env,
          ...ON_THIS_MACHINE,
        }),
      );
    });

    describe("--json", () => {
      it("refuses a project with no local runtime behind it, and says to start one", async () => {
        const app = await aSetUpApp();

        const result = await app.runWithoutServer(["console", "--json"], ON_THIS_MACHINE);

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: CLI_VERSION,
          command: "console",
          source: "http://localhost:8080",
          code: "E_VALIDATION",
          message: "No local admin in this directory or its parents",
          hint: "Run this from the directory the local server was started in, or one inside it. If it was never started, start it first; that is what creates the local admin the console signs in as.",
          next_commands: [expectedPublicCliCommand(`start --cwd ${app.path}`)],
        });
      });

      it("refuses when the server it started was stopped, and says to start it", async () => {
        const app = await aSetUpApp();
        await app.startLocalServer();
        await app.run(["stop", "--json"]);

        const result = await app.run(["console", "--no-open", "--json"]);

        expect(app.envelopeOf(result)).toMatchObject({
          status: "error",
          hint: expect.any(String),
          next_commands: [expectedPublicCliCommand(`start --cwd ${app.path}`)],
        });
      });

      it("refuses a malformed runtime record, and says to reset and start again", async () => {
        const app = await aSetUpApp();
        await app.startLocalServer();
        await app.run(["stop", "--json"]);
        await app.writeMalformedServerRecord();

        const result = await app.run(["console", "--no-open", "--json"]);

        expect(app.envelopeOf(result)).toMatchObject({
          status: "error",
          code: "E_VALIDATION",
          hint: expect.stringContaining("reset --force"),
          next_commands: [
            expectedPublicCliCommand(`reset --force --cwd ${app.path}`),
            expectedPublicCliCommand(`start --cwd ${app.path}`),
          ],
        });
      });

      it("refuses a malformed local admin with the hint that names it", async () => {
        const app = await aSetUpApp();
        await app.writeMalformedLocalAdmin();

        const result = await app.run(["console", "--no-open", "--json"]);

        expect(app.envelopeOf(result)).toMatchObject({
          status: "error",
          code: "E_VALIDATION",
          hint: `Delete ${app.localAdminFile} and run ${expectedPublicCliCommand("reset --force")}, then ${expectedPublicCliCommand("start")}. Both are needed: reset keeps the file, and deleting it alone leaves the server holding the old password.`,
        });
      });

      it("refuses a malformed local admin with the removal, reset and start that repair it", async () => {
        const app = await aSetUpApp();
        await app.writeMalformedLocalAdmin();

        const result = await app.run(["console", "--no-open", "--json"]);

        expect(app.envelopeOf(result)).toMatchObject({
          next_commands: [
            `rm ${app.localAdminFile}`,
            expectedPublicCliCommand(app.againAsRun("reset --force")),
            expectedPublicCliCommand(app.againAsRun("start")),
          ],
        });
      });

      it("refuses when the recorded server does not answer, and says to start it", async () => {
        const app = await aSetUpApp();
        await app.startLocalServer();
        await app.run(["stop", "--json"]);
        await app.writeStoppedServerRecord();

        const result = await app.run(["console", "--no-open", "--json"]);

        expect(app.envelopeOf(result)).toMatchObject({
          status: "error",
          hint: expect.any(String),
          next_commands: [expectedPublicCliCommand(`start --cwd ${app.path}`)],
        });
      });

      it("refuses when the recorded server does not answer, and names the address it tried", async () => {
        const app = await aSetUpApp();
        await app.leaveAStoppedServerWithItsAdmin();

        const result = await app.run(["console", "--no-open", "--json"]);

        expect(app.envelopeOf(result)).toMatchObject({
          status: "error",
          code: "E_LOCAL_SERVER_NOT_RUNNING",
          hint: `No healthy local server responded at ${app.stoppedServerUrl}. Run ${expectedPublicCliCommand("start")} to bring it back.`,
        });
      });

      it("refuses when the recorded server does not answer, with the address in its details", async () => {
        const app = await aSetUpApp();
        await app.leaveAStoppedServerWithItsAdmin();

        const result = await app.run(["console", "--no-open", "--json"]);

        expect(app.envelopeOf(result)).toMatchObject({
          status: "error",
          code: "E_LOCAL_SERVER_NOT_RUNNING",
          details: { server_url: app.stoppedServerUrl },
        });
      });

      it("refuses a server that does not know the local admin, and says to read its logs first", async () => {
        const app = await aSetUpApp();
        await app.startLocalServer({ shape: "without-the-admin" });

        const result = await app.run(["console", "--no-open", "--json"]);

        expect(app.envelopeOf(result)).toMatchObject({
          status: "error",
          code: "E_AUTH",
          hint: `Check ${expectedPublicCliCommand("logs")} first: a server that failed the lookup reports it the same way. If the logs show no error, the local data directory predates the local admin — ${expectedPublicCliCommand("reset --force")} deletes the local data so ${expectedPublicCliCommand("start")} can import it again.`,
        });
      });

      it("refuses a server that does not know the local admin, and offers its logs", async () => {
        const app = await aSetUpApp();
        await app.startLocalServer({ shape: "without-the-admin" });

        const result = await app.run(["console", "--no-open", "--json"]);

        expect(app.envelopeOf(result)).toMatchObject({
          status: "error",
          code: "E_AUTH",
          next_commands: [expectedPublicCliCommand(app.againAsRun("logs"))],
        });
      });

      it("refuses a server in an env file that is not a URL, and says where to fix it", async () => {
        const app = await aSetUpApp();
        await app.writeInvalidServerToEnvFile();

        const result = await app.runWithoutServer(["console", "--json"]);

        expect(app.envelopeOf(result)).toMatchObject({
          status: "error",
          code: "E_VALIDATION",
          hint: "Fix or remove ZITADEL_URL in .env.development.local; it must be a URL such as https://preview.zitadel.com.",
        });
      });

      it("refuses a server in an env file that is not a URL, and says why it is not one", async () => {
        const app = await aSetUpApp();
        await app.writeInvalidServerToEnvFile();

        const result = await app.runWithoutServer(["console", "--json"]);

        expect(app.envelopeOf(result)).toMatchObject({
          status: "error",
          code: "E_VALIDATION",
          details: { cause: 'Invalid server "not-a-url"' },
        });
      });

      it("opens the console of a project on the hosted cloud, not a local one", async () => {
        const app = await aSetUpApp();

        const result = await app.runWithoutServer(["console", "--no-open", "--json"], {
          ZITADEL_URL: "https://preview.zitadel.com",
        });

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: CLI_VERSION,
          command: "console",
          source: "https://preview.zitadel.com",
          data: {
            title: "Console",
            console_url: "https://preview.zitadel.com/console/",
            browser_opened: false,
          },
          warnings: [],
        });
      });

      it("refuses a directory that was never set up", async () => {
        const app = await anApp();

        const result = await app.runWithoutServer(["console", "--json"], ON_THIS_MACHINE);

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: CLI_VERSION,
          command: "console",
          source: "http://localhost:8080",
          code: "E_VALIDATION",
          message: "No local admin in this directory or its parents",
          hint: "Run this from the directory the local server was started in, or one inside it. If it was never started, start it first; that is what creates the local admin the console signs in as.",
          next_commands: [expectedPublicCliCommand(`start --cwd ${app.path}`)],
        });
      });

      it("refuses a server that does not host the platform project", async () => {
        const app = await aSetUpApp();
        const started = await app.startLocalServer();

        const result = await app.runWithoutServer(["console", "--json"], ON_THIS_MACHINE);

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: CLI_VERSION,
          command: "console",
          source: `http://localhost:${app.localPortOf(started)}`,
          code: "E_VALIDATION",
          message:
            "The local server does not host the platform project, so the local admin cannot sign in",
          hint: "Stop it, then start it again so it boots with the platform project and the local admin.",
          next_commands: [
            expectedPublicCliCommand(`stop --cwd ${app.path}`),
            expectedPublicCliCommand(`start --cwd ${app.path}`),
          ],
          details: { server_url: `http://localhost:${app.localPortOf(started)}` },
        });
      });

      it("plans the sign-in it would mint and suggests the real one", async () => {
        const app = await aSetUpApp();
        const started = await app.startLocalServer();

        const result = await app.run(["console", "--dry-run", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: CLI_VERSION,
          command: "console",
          source: `http://localhost:${app.localPortOf(started)}`,
          data: {
            title: "Would mint a console sign-in link (dry run)",
            dry_run: true,
            verb: "mint",
            topic: "console",
            signed_in_as: "admin@zitadel.localhost",
            next_commands: [expectedPublicCliCommand(app.againAsRun("console"))],
          },
          warnings: [],
        });
      });

      it("keeps --no-open in the real sign-in it suggests", async () => {
        const app = await aSetUpApp();
        await app.startLocalServer();

        const result = await app.run(["console", "--dry-run", "--no-open", "--json"]);

        expect(app.envelopeOf(result).data.next_commands).toEqual([
          expectedPublicCliCommand(app.againAsRun("console --no-open")),
        ]);
      });

      it("plans the sign-in from an app inside the directory the server was started in", async () => {
        const parent = await aSetUpApp();
        const started = await parent.startLocalServer();
        const app = await parent.appInside("my-app");

        const result = await app.run(["console", "--dry-run", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: CLI_VERSION,
          command: "console",
          source: `http://localhost:${parent.localPortOf(started)}`,
          data: {
            title: "Would mint a console sign-in link (dry run)",
            dry_run: true,
            verb: "mint",
            topic: "console",
            signed_in_as: "admin@zitadel.localhost",
            next_commands: [expectedPublicCliCommand(app.againAsRun("console"))],
          },
          warnings: [],
        });
      });
    });

    describe.each(SHOWN)("rendered %s", (_how, shown) => {
      it("titles a dry run as --json does, ending in (dry run)", async () => {
        const app = await aSetUpApp();
        await app.startLocalServer();

        const result = await shown(() => app.run(["console", "--dry-run"]));

        expect(result).toSayOnce("Would mint a console sign-in link (dry run)");
      });

      it("names who it would sign in as", async () => {
        const app = await aSetUpApp();
        await app.startLocalServer();

        const result = await shown(() => app.run(["console", "--dry-run"]));

        expect(result).toPrintRow("Signed in as", "admin@zitadel.localhost");
      });

      it("prints the sign-in it planned, once", async () => {
        const app = await aSetUpApp();
        await app.startLocalServer();

        const result = await shown(() => app.run(["console", "--dry-run"]));

        expect(result).toSayOnce(expectedPublicCliCommand(app.againAsRun("console")));
      });

      it("refuses a project with no local runtime, on stderr, once", async () => {
        const app = await aSetUpApp();

        const result = await shown(() => app.runWithoutServer(["console"], ON_THIS_MACHINE));

        expect(result.stdout).toBe("");
        expect(result).toSayOnce("No local admin in this directory or its parents");
      });

      it("suggests starting the server, once", async () => {
        const app = await aSetUpApp();

        const result = await shown(() => app.runWithoutServer(["console"], ON_THIS_MACHINE));

        expect(result).toSayOnce(expectedPublicCliCommand(`start --cwd ${app.path}`));
      });
    });
  });
});
