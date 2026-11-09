import { describe, expect, it } from "vitest";

import { useLocalServers } from "@tests/helpers/local-server";
import { usePlatformMock } from "@tests/helpers/platform";
import { anApp, aSetUpApp, asTerminal, type ScaffoldedApp } from "@tests/helpers/project";

const platform = usePlatformMock();
useLocalServers();

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

        expect(result).toSucceed();
      });
    });

    describe("that is down", () => {
      it("still succeeds", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.status();

        expect(result).toSucceed();
      });
    });

    describe("that refuses connections", () => {
      it("still succeeds", async () => {
        const app = await aSetUpApp();
        platform.refusesConnections();

        const result = await app.status();

        expect(result).toSucceed();
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

        expect(await running).toSucceed();
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
      it("calls a server running although its recorded process has died", async () => {
        const app = await aSetUpApp();
        await app.startLocalServer({ shape: "orphaned" });

        const result = await app.status();

        expect(
          app.envelopeOf<{ server: { lifecycle: string } }>(result).data.server.lifecycle,
        ).toBe("running");
      });

      it("offers a dry-run deploy while nobody has registered", async () => {
        const app = await aSetUpApp();

        const result = await app.status();

        expect(result).toSuggest("deploy --dry-run");
      });

      it("asks for a registered user before anything else", async () => {
        const app = await aSetUpApp();

        const result = await app.status();

        const { data } = app.envelopeOf<{ next_actions: string[] }>(result);
        expect(data.next_actions.join("\n")).toContain("register a user");
      });

      it("reports the project the environment resolves under --env", async () => {
        const app = await aSetUpApp();
        await app.bindEnvironment("production", {
          ZITADEL_URL: "https://prod.example",
          ZITADEL_PROJECT_ID: "proj_prod",
        });

        const result = await app.run(["status", "--env", "production", "--json"]);

        expect(
          app.envelopeOf<{ project: { project_id: string } }>(result).data.project.project_id,
        ).toBe("proj_prod");
      });

      it("calls config pointing at a project that no longer exists orphaned", async () => {
        const app = await anApp();
        await app.writeConfig({
          $schema: "./.zitadel/meta/project.json",
          project: "orphan",
          server: "https://api.zitadel.cloud",
        });

        const result = await app.status();

        expect(
          app.envelopeOf<{ project: { lifecycle: string } }>(result).data.project.lifecycle,
        ).toBe("orphaned-config");
      });
    });

    describe("rendered for a terminal", () => {
      it("names the project", async () => {
        const app = await aConfiguredApp();

        const result = await asTerminal(() =>
          app.runWithoutServer(["status", "--server", "https://self.example"]),
        );

        expect(result).toPrint("Project proj-001");
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

        expect(result).toPrint("Run next:");
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

    it("stops when it is interrupted, rather than reporting a lifecycle it guessed", async () => {
      const app = await aSetUpApp();

      const result = await app.statusInterrupted();

      // The probe answers "unknown" for a server it could not reach, but not
      // for a run the person stopped: that would print a result and exit as
      // though the command had finished.
      expect(result.exitCode).toBe(130);
    }, 30_000);
  });
});
