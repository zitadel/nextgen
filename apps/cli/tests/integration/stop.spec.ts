import { describe, expect, it } from "vitest";

import { useLocalServers } from "@tests/helpers/local-server";
import { usePlatformMock } from "@tests/helpers/platform";
import { anApp, aSetUpApp } from "@tests/helpers/project";
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

describe("stop", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("still succeeds", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.run(["stop", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: CLI_VERSION,
          command: "stop",
          source: "http://localhost:8080",
          data: {
            title: "Local Zitadel server was not running",
            runtime: {
              backend: "missing",
              container_name: expect.stringMatching(/^zitadel-server-[0-9a-f]{12}$/),
              data_preserved: true,
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

        const result = await app.run(["stop", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: CLI_VERSION,
          command: "stop",
          source: "http://localhost:8080",
          data: {
            title: "Local Zitadel server was not running",
            runtime: {
              backend: "missing",
              container_name: expect.stringMatching(/^zitadel-server-[0-9a-f]{12}$/),
              data_preserved: true,
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

        const result = await app.run(["stop", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: CLI_VERSION,
          command: "stop",
          source: "http://localhost:8080",
          data: {
            title: "Local Zitadel server was not running",
            runtime: {
              backend: "missing",
              container_name: expect.stringMatching(/^zitadel-server-[0-9a-f]{12}$/),
              data_preserved: true,
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

      await app.inEveryRendering((how) =>
        app.run(how.json ? ["stop", "--json"] : ["stop"], how.env),
      );
    });

    describe("--json", () => {
      it("stops the server and says which process it stopped", async () => {
        const app = await aSetUpApp();
        const started = await app.startLocalServer();

        const result = await app.run(["stop", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: CLI_VERSION,
          command: "stop",
          source: `http://localhost:${app.localPortOf(started)}`,
          data: {
            title: "Local Zitadel server stopped",
            runtime: {
              backend: "binary",
              pid: app.localPidOf(started),
              log_path: `${app.path}/.zitadel/local/server.log`,
              stop_result: {
                pid: app.localPidOf(started),
                status: "stopped",
                target: "process-group",
                signal: "SIGTERM",
              },
              data_preserved: true,
              data_dir: `${app.path}/.zitadel/local/nextgen-data`,
            },
          },
          warnings: [],
        });
        expect(await app.localServerLifecycle()).toBe("stopped");
      });

      it("succeeds when no local runtime is running", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["stop", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: CLI_VERSION,
          command: "stop",
          source: "http://localhost:8080",
          data: {
            title: "Local Zitadel server was not running",
            runtime: {
              backend: "missing",
              container_name: expect.stringMatching(/^zitadel-server-[0-9a-f]{12}$/),
              data_preserved: true,
            },
          },
          warnings: [],
        });
      });

      it("succeeds in a directory that was never set up", async () => {
        const app = await anApp();

        const result = await app.run(["stop", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: CLI_VERSION,
          command: "stop",
          source: "http://localhost:8080",
          data: {
            title: "Local Zitadel server was not running",
            runtime: {
              backend: "missing",
              container_name: expect.stringMatching(/^zitadel-server-[0-9a-f]{12}$/),
              data_preserved: true,
            },
          },
          warnings: [],
        });
      });

      it("stops a server whose recorded process has died", async () => {
        const app = await aSetUpApp();
        await app.startLocalServer({ shape: "orphaned" });

        const result = await app.run(["stop", "--json"]);

        expect(result).toSucceed();
        expect(await app.localServerLifecycle()).toBe("stopped");
      });

      it("can be run twice without complaining", async () => {
        const app = await aSetUpApp();
        const started = await app.startLocalServer();
        await app.run(["stop", "--json"]);

        const result = await app.run(["stop", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: CLI_VERSION,
          command: "stop",
          source: `http://localhost:${app.localPortOf(started)}`,
          data: {
            title: "Local Zitadel server was not running",
            runtime: {
              backend: "binary",
              pid: app.localPidOf(started),
              log_path: `${app.path}/.zitadel/local/server.log`,
              stop_result: {
                pid: app.localPidOf(started),
                status: "stale",
                target: "process",
              },
              data_preserved: true,
              data_dir: `${app.path}/.zitadel/local/nextgen-data`,
            },
          },
          warnings: [],
        });
      });

      it("plans the stop of a running server and suggests the real one", async () => {
        const app = await aSetUpApp();
        const started = await app.startLocalServer();

        const result = await app.run(["stop", "--dry-run", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: CLI_VERSION,
          command: "stop",
          source: `http://localhost:${app.localPortOf(started)}`,
          data: {
            dry_run: true,
            title: "Would stop the local Zitadel server (dry run)",
            runtime: {
              backend: "binary",
              pid: app.localPidOf(started),
              log_path: `${app.path}/.zitadel/local/server.log`,
              data_preserved: true,
              data_dir: `${app.path}/.zitadel/local/nextgen-data`,
            },
            next_commands: [expectedPublicCliCommand(`stop --cwd ${app.path}`)],
          },
          warnings: [],
        });
      });

      it("stops nothing in a dry run", async () => {
        const app = await aSetUpApp();
        await app.startLocalServer();

        await app.run(["stop", "--dry-run", "--json"]);

        expect(await app.localServerLifecycle()).toBe("running");
      });

      it("plans the stop when nothing is running", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["stop", "--dry-run", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: CLI_VERSION,
          command: "stop",
          source: "http://localhost:8080",
          data: {
            dry_run: true,
            title: "Would stop the local Zitadel server (dry run)",
            runtime: {
              backend: "missing",
              container_name: expect.stringMatching(/^zitadel-server-[0-9a-f]{12}$/),
              data_preserved: true,
            },
            next_commands: [expectedPublicCliCommand(`stop --cwd ${app.path}`)],
          },
          warnings: [],
        });
      });

      it("plans the sweep and suggests the real one", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["stop", "--all", "--dry-run", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: CLI_VERSION,
          command: "stop",
          source: "http://localhost:8080",
          data: {
            dry_run: true,
            title: "Would stop host-wide managed local runtime processes (dry run)",
            sweep: { supported: true, scope: "host", count: 0, processes: [] },
            next_commands: [expectedPublicCliCommand(`stop --all --cwd ${app.path}`)],
          },
          warnings: [],
        });
      });

      it("stops nothing in a dry run sweep", async () => {
        const app = await aSetUpApp();
        await app.startLocalServer();

        await app.run(["stop", "--all", "--dry-run", "--json"]);

        expect(await app.localServerLifecycle()).toBe("running");
      });

      it("sweeps the host and finds nothing to stop", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["stop", "--all", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: CLI_VERSION,
          command: "stop",
          source: "http://localhost:8080",
          data: {
            title: "No host-wide managed local runtime processes found",
            sweep: { supported: true, scope: "host", count: 0, results: [] },
          },
          warnings: [],
        });
      });
    });

    describe.each(SHOWN)("rendered %s", (_how, shown) => {
      it("titles the stop as --json does", async () => {
        const app = await aSetUpApp();
        await app.startLocalServer();

        const result = await shown(() => app.run(["stop"]));

        expect(result).toSayOnce("Local Zitadel server stopped");
      });

      it("names the process it stopped", async () => {
        const app = await aSetUpApp();
        const started = await app.startLocalServer();

        const result = await shown(() => app.run(["stop"]));

        expect(result).toPrintRow("Process", String(app.localPidOf(started)));
      });

      it("names the data it kept", async () => {
        const app = await aSetUpApp();
        await app.startLocalServer();

        const result = await shown(() => app.run(["stop"]));

        expect(result).toPrintRow("Data", `${app.path}/.zitadel/local/nextgen-data`);
      });

      it("says nothing was running when nothing was", async () => {
        const app = await aSetUpApp();

        const result = await shown(() => app.run(["stop"]));

        expect(result).toSayOnce("Local Zitadel server was not running");
      });

      it("titles a dry run as --json does, ending in (dry run)", async () => {
        const app = await aSetUpApp();

        const result = await shown(() => app.run(["stop", "--dry-run"]));

        expect(result).toSayOnce("Would stop the local Zitadel server (dry run)");
      });

      it("names the process it would stop", async () => {
        const app = await aSetUpApp();
        const started = await app.startLocalServer();

        const result = await shown(() => app.run(["stop", "--dry-run"]));

        expect(result).toPrintRow("Process", String(app.localPidOf(started)));
      });

      it("prints the stop it planned, once", async () => {
        const app = await aSetUpApp();

        const result = await shown(() => app.run(["stop", "--dry-run"]));

        expect(result).toSayOnce(expectedPublicCliCommand(`stop --cwd ${app.path}`));
      });

      it("prints the sweep it planned, once", async () => {
        const app = await aSetUpApp();

        const result = await shown(() => app.run(["stop", "--all", "--dry-run"]));

        expect(result).toSayOnce(expectedPublicCliCommand(`stop --all --cwd ${app.path}`));
      });
    });
  });
});
