import { describe, expect, it } from "vitest";

import { useLocalServers } from "@tests/helpers/local-server";
import { usePlatformMock } from "@tests/helpers/platform";
import {
  anApp,
  aSetUpApp,
  asTerminal,
  MOCK_SERVER_URL,
  type ScaffoldedApp,
} from "@tests/helpers/project";
import { cliVersion, expectedPublicCliCommand, parseJson } from "@tests/helpers/run-cli";

const platform = usePlatformMock();
useLocalServers();

/**
 * What the envelope says of Docker, which only a local server run in it asks.
 */
const DOCKER = { available: true, container_exists: false, container_running: false };

/**
 * What the envelope says of a directory with no local server started in it.
 */
const NO_LOCAL_SERVER = {
  lifecycle: "missing",
  runtime: { configured: false },
  docker: DOCKER,
  health: { healthy: false },
};

/**
 * The step status gives while no one is known to have registered.
 */
const VERIFY_AUTH =
  "Verify auth in the browser: open http://localhost:3000, register a user, sign out, sign in again with the same user, and confirm /profile shows Signed in.";

/**
 * The headline of a status.
 */
const TITLE = "Checked the status of the project";

/**
 * The project setup made, as status names it.
 */
const SET_UP_PROJECT = {
  lifecycle: "configured",
  project_id: expect.stringMatching(/^proj-/),
  issuer: "http://localhost:3000",
};

/**
 * Where a spec that stalls the server finds it, which its port varies.
 */
const STALLED_SERVER = /^http:\/\/127\.0\.0\.1:\d+$/;

/** A project configured against a self-hosted server, without being set up. */
async function aConfiguredApp(): Promise<ScaffoldedApp> {
  const app = await anApp();
  await app.writeConfig({
    project: "proj-001",
    server: "https://self.example",
  });
  await app.writeLocalSecret("proj-001");
  return app;
}

describe("status", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("still succeeds", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.status();

        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "status",
          source: MOCK_SERVER_URL,
          status: "ok",
          data: {
            title: TITLE,
            server: NO_LOCAL_SERVER,
            project: SET_UP_PROJECT,
            next_actions: [],
            next_commands: [
              expectedPublicCliCommand(`start --cwd ${app.path}`),
              expectedPublicCliCommand(`doctor --server ${MOCK_SERVER_URL} --cwd ${app.path}`),
              expectedPublicCliCommand(
                `deploy --message '<what changed>' --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
              ),
            ],
          },
          warnings: [],
        });
      });
    });

    describe("that is down", () => {
      it("still succeeds", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.status();

        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "status",
          source: MOCK_SERVER_URL,
          status: "ok",
          data: {
            title: TITLE,
            server: NO_LOCAL_SERVER,
            project: SET_UP_PROJECT,
            next_actions: [],
            next_commands: [
              expectedPublicCliCommand(`start --cwd ${app.path}`),
              expectedPublicCliCommand(`doctor --server ${MOCK_SERVER_URL} --cwd ${app.path}`),
              expectedPublicCliCommand(
                `deploy --message '<what changed>' --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
              ),
            ],
          },
          warnings: [],
        });
      });
    });

    describe("that refuses connections", () => {
      it("still succeeds", async () => {
        const app = await aSetUpApp();
        platform.refusesConnections();

        const result = await app.status();

        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "status",
          source: MOCK_SERVER_URL,
          status: "ok",
          data: {
            title: TITLE,
            server: NO_LOCAL_SERVER,
            project: SET_UP_PROJECT,
            next_actions: [],
            next_commands: [
              expectedPublicCliCommand(`start --cwd ${app.path}`),
              expectedPublicCliCommand(`doctor --server ${MOCK_SERVER_URL} --cwd ${app.path}`),
              expectedPublicCliCommand(
                `deploy --message '<what changed>' --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
              ),
            ],
          },
          warnings: [],
        });
      });
    });

    describe("that accepts the connection and never answers", () => {
      // The presence probe degrades to "unknown" on its own deadline, and the
      // request it gave up on must be given up on too: left in flight it would
      // hold the process open for the whole request timeout after the answer
      // was settled.
      it("still succeeds, without waiting for the request it gave up on", async () => {
        const app = await aSetUpApp();
        const waiting = platform.hangs();

        const running = app.status();
        await waiting;

        expect(app.envelopeOf(await running)).toEqual({
          cli_version: cliVersion.version,
          command: "status",
          source: MOCK_SERVER_URL,
          status: "ok",
          data: {
            title: TITLE,
            server: NO_LOCAL_SERVER,
            project: SET_UP_PROJECT,
            next_actions: [],
            next_commands: [
              expectedPublicCliCommand(`start --cwd ${app.path}`),
              expectedPublicCliCommand(`doctor --server ${MOCK_SERVER_URL} --cwd ${app.path}`),
              expectedPublicCliCommand(
                `deploy --message '<what changed>' --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
              ),
            ],
          },
          warnings: [],
        });
      });
    });
  });

  describe("against a valid server", () => {
    it("holds its invariants in every rendering", async () => {
      const app = await aSetUpApp();
      platform.servesAHostileOrigin();
      const args = ["status"];

      await app.inEveryRendering((how) => app.run(how.json ? [...args, "--json"] : args, how.env));
    });

    describe("--json", () => {
      it("reports a project nobody has registered in, with a dry-run deploy to offer", async () => {
        const app = await aSetUpApp();

        const result = await app.status();

        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "status",
          source: MOCK_SERVER_URL,
          status: "ok",
          data: {
            title: TITLE,
            server: NO_LOCAL_SERVER,
            project: SET_UP_PROJECT,
            next_actions: [VERIFY_AUTH],
            next_commands: [
              expectedPublicCliCommand(`start --cwd ${app.path}`),
              expectedPublicCliCommand(`doctor --server ${MOCK_SERVER_URL} --cwd ${app.path}`),
              expectedPublicCliCommand(
                `deploy --dry-run --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
              ),
            ],
          },
          warnings: [],
        });
      });

      it("calls a server running although its recorded process has died", async () => {
        const app = await aSetUpApp();
        await app.startLocalServer({ shape: "orphaned" });

        const result = await app.status();

        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "status",
          source: MOCK_SERVER_URL,
          status: "ok",
          data: {
            title: TITLE,
            server: {
              lifecycle: "running",
              runtime: {
                configured: true,
                backend: "binary",
                port: expect.any(Number),
                server_url: expect.stringMatching(/^http:\/\/localhost:\d+$/),
                data_dir: `${app.path}/.zitadel/local/nextgen-data`,
                created_at: expect.any(String),
                env: { injected: ["NEXTGEN_HTTPCLIENT_ALLOW_LIST"] },
                pid: expect.any(Number),
                command: expect.any(String),
                log_path: `${app.path}/.zitadel/local/server.log`,
                server_package: "@zitadel/server",
                server_version: "override",
              },
              docker: DOCKER,
              process: { pid: expect.any(Number), running: true },
              health: { healthy: true, url: expect.stringMatching(/^http:\/\/localhost:\d+$/) },
            },
            project: SET_UP_PROJECT,
            next_actions: [VERIFY_AUTH],
            next_commands: [
              expectedPublicCliCommand(`doctor --server ${MOCK_SERVER_URL} --cwd ${app.path}`),
              expectedPublicCliCommand(
                `deploy --dry-run --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
              ),
            ],
          },
          warnings: [],
        });
      });

      it("reports the project the environment resolves under --env", async () => {
        const app = await aSetUpApp();
        await app.bindEnvironment("production", {
          ZITADEL_URL: "https://prod.example",
          ZITADEL_PROJECT_ID: "proj_prod",
        });

        const result = await app.run(["status", "--env", "production", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "status",
          source: MOCK_SERVER_URL,
          status: "ok",
          data: {
            title: TITLE,
            server: NO_LOCAL_SERVER,
            project: { lifecycle: "configured", project_id: "proj_prod" },
            next_actions: [],
            next_commands: [
              expectedPublicCliCommand(`start --cwd ${app.path}`),
              expectedPublicCliCommand(
                `doctor --env production --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
              ),
              expectedPublicCliCommand(
                `deploy --message '<what changed>' --env production --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
              ),
            ],
          },
          warnings: [],
        });
      });

      it("says an environment that names no project names none", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["status", "--env", "nope", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "status",
          source: MOCK_SERVER_URL,
          status: "ok",
          data: {
            title: TITLE,
            server: NO_LOCAL_SERVER,
            project: {
              lifecycle: "not-configured",
              environment: "nope",
              message: "The nope environment names no project.",
            },
            next_actions: [],
            next_commands: [
              expectedPublicCliCommand(`start --cwd ${app.path}`),
              expectedPublicCliCommand(`env add nope --cwd ${app.path}`),
            ],
          },
          warnings: [],
        });
      });

      it("calls config pointing at a project that no longer exists orphaned", async () => {
        const app = await anApp();
        await app.writeConfig({
          $schema: "./.zitadel/meta/project.json",
          project: "orphan",
          server: "https://api.zitadel.cloud",
        });

        const result = await app.status();

        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "status",
          source: MOCK_SERVER_URL,
          status: "ok",
          data: {
            title: TITLE,
            server: NO_LOCAL_SERVER,
            project: {
              lifecycle: "orphaned-config",
              project_id: "orphan",
              message: "zitadel.json exists but .zitadel/secret is missing.",
            },
            next_actions: [],
            next_commands: [
              expectedPublicCliCommand(`start --cwd ${app.path}`),
              expectedPublicCliCommand(`setup --force --cwd ${app.path}`),
              expectedPublicCliCommand(
                `doctor --fix --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
              ),
            ],
          },
          warnings: [],
        });
      });

      it("carries a project id as it was written, escape sequence and all", async () => {
        const app = await anApp();
        await app.writeConfig({ project: "p\u001bx", server: "https://self.example" });

        const result = await app.status();

        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "status",
          source: MOCK_SERVER_URL,
          status: "ok",
          data: {
            title: TITLE,
            server: NO_LOCAL_SERVER,
            project: {
              lifecycle: "orphaned-config",
              project_id: "p\u001bx",
              message: "zitadel.json exists but .zitadel/secret is missing.",
            },
            next_actions: [],
            next_commands: [
              expectedPublicCliCommand(`start --cwd ${app.path}`),
              expectedPublicCliCommand(`setup --force --cwd ${app.path}`),
              expectedPublicCliCommand(
                `doctor --fix --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
              ),
            ],
          },
          warnings: [],
        });
      });

      it("refuses a server that is neither local nor a URL", async () => {
        const app = await aSetUpApp();

        const result = await app.runWithoutServer(["status", "--server", "nope", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "status",
          source: "",
          code: "E_VALIDATION",
          message: 'Invalid server "nope"',
          hint: "Use local, or a URL like https://acme.zitadel.cloud.",
        });
      });
    });

    describe("rendered for a terminal", () => {
      it("heads the piped text with the headline the envelope carries", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["status"]);

        expect(result.stdout.split("\n")[0]).toBe(TITLE);
      });

      it("names the project and its issuer when piped", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["status"]);

        expect(result).toPrint("lifecycle configured, issuer http://localhost:3000.");
      });

      it("names the local server's address and process when piped", async () => {
        const app = await aSetUpApp();
        const started = await app.startLocalServer({ shape: "orphaned" });

        const result = await app.run(["status"]);

        expect(result).toPrint(
          `The local server is running and healthy at http://localhost:${app.localPortOf(started)} (binary, pid ${app.localPidOf(started)}).`,
        );
      });

      it("says each command to run next once", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["status"]);

        expect(result).toSayOnce(
          expectedPublicCliCommand(`doctor --server ${MOCK_SERVER_URL} --cwd ${app.path}`),
        );
      });

      it("spells out an escape sequence in a project id", async () => {
        const app = await anApp();
        await app.writeConfig({ project: "p\u001bx", server: "https://self.example" });

        const result = await app.run(["status"]);

        expect(result).toPrint("Project p\\x1bx, lifecycle orphaned-config.");
      });

      it("names the project", async () => {
        const app = await aConfiguredApp();

        const result = await asTerminal(() =>
          app.runWithoutServer(["status", "--server", "https://self.example"]),
        );

        expect(result).toPrint("Project proj-001");
      });

      it("says whether a local server was started in the directory", async () => {
        const app = await aConfiguredApp();

        const result = await asTerminal(() =>
          app.runWithoutServer(["status", "--server", "https://self.example"]),
        );

        expect(result).toPrint("No local server was started in this directory.");
      });

      it("ends on where it ran", async () => {
        const app = await aConfiguredApp();

        const result = await asTerminal(() =>
          app.runWithoutServer(["status", "--server", "https://self.example"]),
        );

        expect(result).toPrint("project proj-001 on self.example");
      });

      it("renders text rather than a json envelope", async () => {
        const app = await aConfiguredApp();

        const result = await asTerminal(() =>
          app.runWithoutServer(["status", "--server", "https://self.example"]),
        );

        expect(result).toPrintNoJson();
      });

      it("closes with what to do next", async () => {
        const app = await aConfiguredApp();

        const result = await asTerminal(() =>
          app.runWithoutServer(["status", "--server", "https://self.example"]),
        );

        expect(result).toPrint("Next:");
      });

      it("ends on where to find every command", async () => {
        const app = await aConfiguredApp();

        const result = await asTerminal(() =>
          app.runWithoutServer(["status", "--server", "https://self.example"]),
        );

        expect(result).toPrint("Explore all commands:");
      });
    });
  });

  describe("against a server that accepts the connection and never answers", () => {
    it("exits once the probe has given up, rather than waiting out the request", async () => {
      const app = await aSetUpApp();

      const { result, elapsedMs } = await app.statusAgainstAStalledServer();

      // The probe reports "unknown" on its own deadline, so the run says what
      // it knows and the process ends: a request left in flight would hold it
      // until the client's own 30s timeout.
      expect(result).toSucceed();
      expect(elapsedMs).toBeLessThan(10_000);
    }, 30_000);

    it("reports what it knows by the time the probe has given up", async () => {
      const app = await aSetUpApp();

      const { result } = await app.statusAgainstAStalledServer();

      expect(app.envelopeOf(result)).toEqual({
        cli_version: cliVersion.version,
        command: "status",
        source: expect.stringMatching(STALLED_SERVER),
        status: "ok",
        data: {
          title: TITLE,
          server: NO_LOCAL_SERVER,
          project: SET_UP_PROJECT,
          next_actions: [],
          next_commands: [
            expectedPublicCliCommand(`start --cwd ${app.path}`),
            expect.stringMatching(
              new RegExp(
                `^npx @zitadel/cli@\\S+ doctor --server http://127\\.0\\.0\\.1:\\d+ --cwd ${app.path}$`,
              ),
            ),
            expect.stringMatching(
              new RegExp(
                `^npx @zitadel/cli@\\S+ deploy --message '<what changed>' --server http://127\\.0\\.0\\.1:\\d+ --cwd ${app.path}$`,
              ),
            ),
          ],
        },
        warnings: [],
      });
    }, 30_000);

    it("stops when it is interrupted, rather than reporting a lifecycle it guessed", async () => {
      const app = await aSetUpApp();

      const result = await app.statusInterrupted();

      // The probe answers "unknown" for a server it could not reach, but not
      // for a run the person stopped: that would print a result and exit as
      // though the command had finished.
      expect(result.exitCode).toBe(130);
    }, 30_000);

    it("says it was cancelled in one envelope when it is interrupted", async () => {
      const app = await aSetUpApp();

      const result = await app.statusInterrupted();

      expect(parseJson(result.stdout)).toEqual({
        status: "error",
        cli_version: cliVersion.version,
        command: "status",
        source: expect.stringMatching(STALLED_SERVER),
        code: "E_CANCELLED",
        message: "Cancelled",
        hint: "The command was cancelled with Ctrl-C.",
      });
    }, 30_000);
  });
});
