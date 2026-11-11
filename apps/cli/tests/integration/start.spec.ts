import { describe, expect, it } from "vitest";

import { useLocalServers } from "@tests/helpers/local-server";
import { usePlatformMock } from "@tests/helpers/platform";
import { nextPort } from "@tests/helpers/ports";
import { aSetUpApp } from "@tests/helpers/project";
import { cliVersion, expectedPublicCliCommand } from "@tests/helpers/run-cli";
import { asTerminal, offTerminal } from "@tests/helpers/terminal";

const platform = usePlatformMock();
useLocalServers();

const CLI_VERSION = cliVersion.version;

/** The two ways a person reads a run, which must say the same thing. */
const SHOWN = [
  ["on a terminal", asTerminal],
  ["piped", offTerminal],
] as const;

describe("start", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("refuses a port it cannot bind before it reaches the server", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.run(["start", "--port", "0", "--json"]);

        expect(result).toFailWith("E_VALIDATION");
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: CLI_VERSION,
          command: "start",
          source: "",
          code: "E_VALIDATION",
          message: "0 is not a TCP port",
          hint: "Use a TCP port from 1 to 65535.",
        });
      });
    });

    describe("that is down", () => {
      it("refuses a port it cannot bind before it reaches the server", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.run(["start", "--port", "0", "--json"]);

        expect(result).toFailWith("E_VALIDATION");
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: CLI_VERSION,
          command: "start",
          source: "",
          code: "E_VALIDATION",
          message: "0 is not a TCP port",
          hint: "Use a TCP port from 1 to 65535.",
        });
      });
    });

    describe("that refuses connections", () => {
      it("refuses a port it cannot bind before it reaches the server", async () => {
        const app = await aSetUpApp();
        platform.refusesConnections();

        const result = await app.run(["start", "--port", "0", "--json"]);

        expect(result).toFailWith("E_VALIDATION");
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: CLI_VERSION,
          command: "start",
          source: "",
          code: "E_VALIDATION",
          message: "0 is not a TCP port",
          hint: "Use a TCP port from 1 to 65535.",
        });
      });
    });
  });

  describe("against a valid server", () => {
    it("holds its invariants in every rendering", async () => {
      const app = await aSetUpApp();
      const args = ["start", "--port", "0"];

      await app.inEveryRendering((how) => app.run(how.json ? [...args, "--json"] : args, how.env));
    });

    describe("--json", () => {
      it("starts the server and reports where it listens", async () => {
        const app = await aSetUpApp();
        const port = nextPort();

        const result = await app.startLocalServer({ port });

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: CLI_VERSION,
          command: "start",
          source: `http://localhost:${port}`,
          data: {
            title: "Local Zitadel server is ready",
            runtime: {
              backend: "binary",
              pid: expect.any(Number),
              log_path: `${app.path}/.zitadel/local/server.log`,
              server_package: "@zitadel/server",
              server_version: "override",
              port,
              data_dir: `${app.path}/.zitadel/local/nextgen-data`,
              env: { injected: ["NEXTGEN_HTTPCLIENT_ALLOW_LIST"] },
            },
            urls: {
              api: `http://localhost:${port}`,
              console: `http://localhost:${port}/ui/console/`,
            },
            next_actions: [
              "Create an app with authentication. Run setup in this directory or a subdirectory.",
              "Setup asks for a framework and sign-in method, creates or updates your app, and installs its dependencies.",
              `When a sign-in or a request fails, the server's log says why: run ${expectedPublicCliCommand("logs --follow")} in another terminal to watch it.`,
            ],
            next_commands: [expectedPublicCliCommand(`setup --server local --cwd ${app.path}`)],
          },
          warnings: [],
        });
      });

      it("says the server is already running when it is started again", async () => {
        const app = await aSetUpApp();
        const first = await app.startLocalServer();

        const again = await app.startLocalServer({ port: app.localPortOf(first) });

        expect(app.envelopeOf(again)).toEqual({
          status: "ok",
          cli_version: CLI_VERSION,
          command: "start",
          source: `http://localhost:${app.localPortOf(first)}`,
          data: {
            title: "Local Zitadel server is already running",
            runtime: {
              backend: "binary",
              pid: app.localPidOf(first),
              log_path: `${app.path}/.zitadel/local/server.log`,
              server_package: "@zitadel/server",
              server_version: "override",
              port: app.localPortOf(first),
              data_dir: `${app.path}/.zitadel/local/nextgen-data`,
              env: { injected: ["NEXTGEN_HTTPCLIENT_ALLOW_LIST"] },
            },
            urls: {
              api: `http://localhost:${app.localPortOf(first)}`,
              console: `http://localhost:${app.localPortOf(first)}/ui/console/`,
            },
            next_actions: [
              "Create an app with authentication. Run setup in this directory or a subdirectory.",
              "Setup asks for a framework and sign-in method, creates or updates your app, and installs its dependencies.",
              `When a sign-in or a request fails, the server's log says why: run ${expectedPublicCliCommand("logs --follow")} in another terminal to watch it.`,
            ],
            next_commands: [expectedPublicCliCommand(`setup --server local --cwd ${app.path}`)],
          },
          warnings: [],
        });
      });

      it("refuses a port outside the usable range", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["start", "--port", "99999", "--json"]);

        expect(result).toFailWith("E_VALIDATION");
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: CLI_VERSION,
          command: "start",
          source: "",
          code: "E_VALIDATION",
          message: "99999 is not a TCP port",
          hint: "Use a TCP port from 1 to 65535.",
        });
      });

      it("refuses port zero", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["start", "--port", "0", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: CLI_VERSION,
          command: "start",
          source: "",
          code: "E_VALIDATION",
          message: "0 is not a TCP port",
          hint: "Use a TCP port from 1 to 65535.",
        });
      });

      it("refuses an image for a runtime that takes none, suggesting nothing", async () => {
        const app = await aSetUpApp();

        const result = await app.run([
          "start",
          "--runtime",
          "binary",
          "--image",
          "zitadel:latest",
          "--json",
        ]);

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: CLI_VERSION,
          command: "start",
          source: "http://localhost:8080",
          code: "E_VALIDATION",
          message: "--image requires --runtime docker",
          hint: "Pass --runtime docker with --image <tag>, or omit --image for the npm binary runtime.",
        });
      });

      it("brings a directory back on the port it had", async () => {
        const app = await aSetUpApp();
        const first = await app.startLocalServer();
        await app.run(["stop", "--json"]);

        const again = await app.restartLocalServer();

        expect(app.envelopeOf(again)).toEqual({
          status: "ok",
          cli_version: CLI_VERSION,
          command: "start",
          source: `http://localhost:${app.localPortOf(first)}`,
          data: {
            title: "Local Zitadel server is ready",
            runtime: {
              backend: "binary",
              pid: expect.any(Number),
              log_path: `${app.path}/.zitadel/local/server.log`,
              server_package: "@zitadel/server",
              server_version: "override",
              port: app.localPortOf(first),
              data_dir: `${app.path}/.zitadel/local/nextgen-data`,
              env: { injected: ["NEXTGEN_HTTPCLIENT_ALLOW_LIST"] },
            },
            urls: {
              api: `http://localhost:${app.localPortOf(first)}`,
              console: `http://localhost:${app.localPortOf(first)}/ui/console/`,
            },
            next_actions: [
              "Create an app with authentication. Run setup in this directory or a subdirectory.",
              "Setup asks for a framework and sign-in method, creates or updates your app, and installs its dependencies.",
              `When a sign-in or a request fails, the server's log says why: run ${expectedPublicCliCommand("logs --follow")} in another terminal to watch it.`,
            ],
            next_commands: [expectedPublicCliCommand(`setup --server local --cwd ${app.path}`)],
          },
          warnings: [],
        });
      });

      it("names the server it started as its source, even when it had to move", async () => {
        const app = await aSetUpApp();
        const first = await app.startLocalServer();
        await app.run(["stop", "--json"]);
        const holder = await aSetUpApp();
        await holder.startLocalServer({ port: app.localPortOf(first) });

        const again = await app.restartLocalServer();

        expect(app.envelopeOf(again)).toEqual({
          status: "ok",
          cli_version: CLI_VERSION,
          command: "start",
          source: `http://localhost:${app.localPortOf(again)}`,
          data: {
            title: "Local Zitadel server is ready",
            runtime: {
              backend: "binary",
              pid: expect.any(Number),
              log_path: `${app.path}/.zitadel/local/server.log`,
              server_package: "@zitadel/server",
              server_version: "override",
              port: app.localPortOf(again),
              data_dir: `${app.path}/.zitadel/local/nextgen-data`,
              env: { injected: ["NEXTGEN_HTTPCLIENT_ALLOW_LIST"] },
            },
            urls: {
              api: `http://localhost:${app.localPortOf(again)}`,
              console: `http://localhost:${app.localPortOf(again)}/ui/console/`,
            },
            next_actions: [
              "Create an app with authentication. Run setup in this directory or a subdirectory.",
              "Setup asks for a framework and sign-in method, creates or updates your app, and installs its dependencies.",
              `When a sign-in or a request fails, the server's log says why: run ${expectedPublicCliCommand("logs --follow")} in another terminal to watch it.`,
            ],
            next_commands: [expectedPublicCliCommand(`setup --server local --cwd ${app.path}`)],
          },
          warnings: [],
        });
      });

      it("refuses a port another directory's server holds", async () => {
        const owner = await aSetUpApp();
        const held = await owner.startLocalServer();
        const other = await aSetUpApp();

        const result = await other.startLocalServer({ port: owner.localPortOf(held) });

        expect(other.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: CLI_VERSION,
          command: "start",
          source: `http://localhost:${owner.localPortOf(held)}`,
          code: "E_PORT_IN_USE",
          message: `Port ${owner.localPortOf(held)} is already in use`,
          hint: `Stop the process using http://localhost:${owner.localPortOf(held)}, run ${expectedPublicCliCommand("stop --all")} for managed local runtimes, or choose another port.`,
          next_commands: [
            expectedPublicCliCommand("stop --all"),
            expectedPublicCliCommand("start --port 8080"),
          ],
          details: {
            port: owner.localPortOf(held),
            server_url: `http://localhost:${owner.localPortOf(held)}`,
            listeners: [
              {
                address: expect.stringContaining(`:${owner.localPortOf(held)}`),
                command: "node",
                host: expect.any(String),
                pid: owner.localPidOf(held),
                port: owner.localPortOf(held),
              },
            ],
          },
        });
      });

      it("leaves a running server alone when the port it is asked to move to is held", async () => {
        const owner = await aSetUpApp();
        const held = await owner.startLocalServer();
        const app = await aSetUpApp();
        await app.startLocalServer();

        const result = await app.startLocalServer({ port: owner.localPortOf(held) });

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: CLI_VERSION,
          command: "start",
          source: `http://localhost:${owner.localPortOf(held)}`,
          code: "E_PORT_IN_USE",
          message: `Port ${owner.localPortOf(held)} is already in use`,
          hint: `Stop the process using http://localhost:${owner.localPortOf(held)}, run ${expectedPublicCliCommand("stop --all")} for managed local runtimes, or choose another port.`,
          next_commands: [
            expectedPublicCliCommand("stop --all"),
            expectedPublicCliCommand("start --port 8080"),
          ],
          details: {
            port: owner.localPortOf(held),
            server_url: `http://localhost:${owner.localPortOf(held)}`,
            listeners: [
              {
                address: expect.stringContaining(`:${owner.localPortOf(held)}`),
                command: "node",
                host: expect.any(String),
                pid: owner.localPidOf(held),
                port: owner.localPortOf(held),
              },
            ],
          },
        });
        expect(await app.localServerLifecycle()).toBe("running");
      });

      it("runs one server when two starts race in one directory", async () => {
        const app = await aSetUpApp();

        const [first, second] = await app.startLocalServerTwiceAtOnce();

        expect(app.localPidOf(second!)).toBe(app.localPidOf(first!));
      });

      it("plans a start although the directory's server record cannot be read", async () => {
        const app = await aSetUpApp();
        await app.corruptLocalServerRecord();

        const result = await app.run(["start", "--dry-run", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: CLI_VERSION,
          command: "start",
          source: "http://localhost:8080",
          data: {
            dry_run: true,
            title: "Would start the local Zitadel server (dry run)",
            runtime: { backend: "binary", port: 8080 },
            urls: {
              api: "http://localhost:8080",
              console: "http://localhost:8080/ui/console/",
            },
            next_commands: [expectedPublicCliCommand(`start --cwd ${app.path}`)],
          },
          warnings: [],
        });
      });

      it("suggests the start it planned, with the flags it was given", async () => {
        const app = await aSetUpApp();

        const result = await app.run([
          "start",
          "--port",
          "9000",
          "--runtime",
          "binary",
          "--dry-run",
          "--json",
        ]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: CLI_VERSION,
          command: "start",
          source: "http://localhost:9000",
          data: {
            dry_run: true,
            title: "Would start the local Zitadel server (dry run)",
            runtime: { backend: "binary", port: 9000 },
            urls: {
              api: "http://localhost:9000",
              console: "http://localhost:9000/ui/console/",
            },
            next_commands: [
              expectedPublicCliCommand(`start --port 9000 --runtime binary --cwd ${app.path}`),
            ],
          },
          warnings: [],
        });
      });

      it("plans a docker start with the image it was given", async () => {
        const app = await aSetUpApp();

        const result = await app.run([
          "start",
          "--runtime",
          "docker",
          "--image",
          "example.test/zitadel:1",
          "--dry-run",
          "--json",
        ]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: CLI_VERSION,
          command: "start",
          source: "http://localhost:8080",
          data: {
            dry_run: true,
            title: "Would start the local Zitadel server (dry run)",
            runtime: {
              backend: "docker",
              container_name: expect.stringMatching(/^zitadel-server-[0-9a-f]{12}$/),
              image: "example.test/zitadel:1",
              port: 8080,
            },
            urls: {
              api: "http://localhost:8080",
              console: "http://localhost:8080/ui/console/",
            },
            next_commands: [
              expectedPublicCliCommand(
                `start --runtime docker --image example.test/zitadel:1 --cwd ${app.path}`,
              ),
            ],
          },
          warnings: [],
        });
      });

      it("starts nothing in a dry run", async () => {
        const app = await aSetUpApp();

        await app.run(["start", "--dry-run", "--json"]);

        expect(await app.localServerLifecycle()).not.toBe("running");
      });
    });

    describe.each(SHOWN)("rendered %s", (_how, shown) => {
      it("titles the start as --json does", async () => {
        const app = await aSetUpApp();

        const result = await shown(() => app.startLocalServer({ json: false }));

        expect(result).toSayOnce("Local Zitadel server is ready");
      });

      it("prints where the console is", async () => {
        const app = await aSetUpApp();

        const result = await shown(() => app.startLocalServer({ json: false }));

        expect(result).toPrint("/ui/console/");
      });

      it("prints the process it started", async () => {
        const app = await aSetUpApp();

        const result = await shown(() => app.startLocalServer({ json: false }));

        expect(result).toPrint("Process");
      });

      it("prints the port it would use in a dry run", async () => {
        const app = await aSetUpApp();

        const result = await shown(() => app.run(["start", "--port", "9000", "--dry-run"]));

        expect(result).toPrint("localhost:9000");
      });

      it("prints the image it would use in a dry run", async () => {
        const app = await aSetUpApp();

        const result = await shown(() =>
          app.run([
            "start",
            "--runtime",
            "docker",
            "--image",
            "example.test/zitadel:1",
            "--dry-run",
          ]),
        );

        expect(result).toPrintRow("Image", "example.test/zitadel:1");
      });

      it("titles a dry run as --json does, ending in (dry run)", async () => {
        const app = await aSetUpApp();

        const result = await shown(() => app.run(["start", "--port", "9000", "--dry-run"]));

        expect(result).toSayOnce("Would start the local Zitadel server (dry run)");
      });

      it("prints the start it planned, with the flags it was given", async () => {
        const app = await aSetUpApp();

        const result = await shown(() =>
          app.run(["start", "--port", "9000", "--runtime", "binary", "--dry-run"]),
        );

        expect(result).toSayOnce(
          expectedPublicCliCommand(`start --port 9000 --runtime binary --cwd ${app.path}`),
        );
      });

      it("refuses a port nothing can listen on, once, on stderr", async () => {
        const app = await aSetUpApp();

        const result = await shown(() => app.run(["start", "--port", "0"]));

        expect(result).toFail();
        expect(result.stdout).toBe("");
        expect(result).toSayOnce("0 is not a TCP port");
      });
    });
  });
});
