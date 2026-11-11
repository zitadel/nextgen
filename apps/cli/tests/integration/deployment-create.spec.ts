import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import {
  aSetUpApp,
  MOCK_SERVER_URL,
  type ScaffoldedApp,
  SETUP_ORIGIN,
} from "@tests/helpers/project";
import { cliVersion, expectedPublicCliCommand, pressCtrlC } from "@tests/helpers/run-cli";
import { asTerminal, RENDERINGS } from "@tests/helpers/terminal";

const platform = usePlatformMock();

const DEPLOYMENT_ID = /^dep_[a-zA-Z0-9_-]+$/;
const DEPLOYMENTS_URL = /^http:\/\/mock\.zitadel\.test\/api\/v1\/deployments\?project_id=proj-/;

async function aRelease(app: ScaffoldedApp): Promise<string> {
  const result = await app.run(["release", "create", "--non-interactive", "--json"]);
  expect(result, "arranging a release should have succeeded").toSucceed();
  return app.envelopeOf<{ release_id: string }>(result).data.release_id;
}

describe("deployment create", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        const releaseId = await aRelease(app);
        platform.isNotZitadel();

        const result = await app.run([
          "deployment",
          "create",
          "--release",
          releaseId,
          "--non-interactive",
          "--json",
        ]);

        expect(result).toFailWith("E_NOT_FOUND");
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "deployment:create",
          source: MOCK_SERVER_URL,
          code: "E_NOT_FOUND",
          message: expect.stringMatching(
            /^POST http:\/\/mock\.zitadel\.test\/api\/v1\/deployments/,
          ),
          details: {
            status: 404,
            url: expect.stringMatching(DEPLOYMENTS_URL),
            body: { raw: "<html>not here</html>" },
          },
        });
      });
    });

    describe("that is down", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        const releaseId = await aRelease(app);
        platform.isUnavailable();

        const result = await app.run([
          "deployment",
          "create",
          "--release",
          releaseId,
          "--non-interactive",
          "--json",
        ]);

        expect(result).toFailWith("E_NETWORK");
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "deployment:create",
          source: MOCK_SERVER_URL,
          code: "E_NETWORK",
          message: "down",
          details: {
            status: 503,
            url: expect.stringMatching(DEPLOYMENTS_URL),
            body: { code: "unavailable", message: "down" },
          },
        });
      });
    });
  });

  describe("against a valid server", () => {
    it("holds its invariants in every rendering", async () => {
      const app = await aSetUpApp();
      await app.addPrimaryOrigin();
      const args = ["deployment", "create", "--release", await aRelease(app)];
      platform.servesAHostileOrigin();

      await app.inEveryRendering((how) => app.run(how.json ? [...args, "--json"] : args, how.env));
    });

    describe("--json", () => {
      it("makes an existing release live on every primary origin", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin("https://app.acme.com");
        const releaseId = await aRelease(app);

        const result = await app.run([
          "deployment",
          "create",
          "--release",
          releaseId,
          "--non-interactive",
          "--json",
        ]);

        expect(result).toSucceed();
        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "deployment:create",
          source: MOCK_SERVER_URL,
          status: "ok",
          data: {
            title: `Deployed ${releaseId}`,
            deployment_id: expect.stringMatching(DEPLOYMENT_ID),
            release_id: releaseId,
            origins: [SETUP_ORIGIN.pattern, "https://app.acme.com"],
            next_commands: [expectedPublicCliCommand(app.againAsRun("deployment list"))],
          },
          warnings: [],
        });
      });

      it("keeps an origin the server put an escape sequence in as it came", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin("https://app.acme.com");
        const releaseId = await aRelease(app);
        const origin = platform.servesAHostileOrigin();

        const result = await app.run([
          "deployment",
          "create",
          "--release",
          releaseId,
          "--non-interactive",
          "--json",
        ]);

        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "deployment:create",
          source: MOCK_SERVER_URL,
          status: "ok",
          data: {
            title: "Deployed rel_1",
            deployment_id: "dep_hostile",
            release_id: "rel_1",
            origins: [origin],
            next_commands: [expectedPublicCliCommand(app.againAsRun("deployment list"))],
          },
          warnings: [],
        });
      });

      it("plans the deployment on a dry run, keeping the flags it was typed with", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin("https://app.acme.com");
        const releaseId = await aRelease(app);

        const result = await app.run([
          "deployment",
          "create",
          "--release",
          releaseId,
          "-m",
          "ship it",
          "--dry-run",
          "--non-interactive",
          "--json",
        ]);

        expect(result).toSucceed();
        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "deployment:create",
          source: MOCK_SERVER_URL,
          status: "ok",
          data: {
            dry_run: true,
            title: `Would deploy ${releaseId} to primary (dry run)`,
            release_id: releaseId,
            targets: "primary",
            next_commands: [
              expectedPublicCliCommand(
                app.againAsRun(`deployment create --release ${releaseId} --message 'ship it'`),
              ),
            ],
          },
          warnings: [],
        });
      });

      it("writes no deployment on a dry run", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin("https://app.acme.com");
        const releaseId = await aRelease(app);
        const before = await app.liveDeploymentCount();

        await app.run([
          "deployment",
          "create",
          "--release",
          releaseId,
          "--dry-run",
          "--non-interactive",
          "--json",
        ]);

        expect(await app.liveDeploymentCount()).toBe(before);
      });

      it("refuses a deployment id given as the release", async () => {
        const app = await aSetUpApp();

        const result = await app.run([
          "deployment",
          "create",
          "--release",
          "dep_01KX5N7C9D2E7F0N9WD3P2E4YM6",
          "--json",
        ]);

        expect(result).toFailWith("E_VALIDATION");
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "deployment:create",
          source: "",
          code: "E_VALIDATION",
          message:
            "Invalid --release: must be a release ID: rel_ followed by letters, digits, _ or -",
          hint: `Find one with ${expectedPublicCliCommand("release list")}.`,
          next_commands: [expectedPublicCliCommand("release list")],
          details: { argument: "--release" },
        });
      });

      it("refuses a release holding an escape sequence", async () => {
        const app = await aSetUpApp();

        const result = await app.run([
          "deployment",
          "create",
          "--release",
          "rel_\u001b[2Jwiped",
          "--json",
        ]);

        expect(result).toFailWith("E_VALIDATION");
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "deployment:create",
          source: "",
          code: "E_VALIDATION",
          message:
            "Invalid --release: must be a release ID: rel_ followed by letters, digits, _ or -",
          hint: `Find one with ${expectedPublicCliCommand("release list")}.`,
          next_commands: [expectedPublicCliCommand("release list")],
          details: { argument: "--release" },
        });
      });

      it("refuses a blank --message", async () => {
        const app = await aSetUpApp();
        const releaseId = await aRelease(app);

        const result = await app.run([
          "deployment",
          "create",
          "--release",
          releaseId,
          "--message",
          " ",
          "--json",
        ]);

        expect(result).toFailWith("E_VALIDATION");
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "deployment:create",
          source: "",
          code: "E_VALIDATION",
          message: "the value is empty",
          hint: "Pass a shorter summary with -m.",
          details: { argument: "--message" },
        });
      });

      it("takes no --origin, as primary origins are never named one by one", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin("https://app.example.com");

        const result = await app.run([
          "deployment",
          "create",
          "--release",
          "rel_01KX3RG8A7F0N9WD3P2E4YM5C1",
          "--origin",
          "https://app.example.com",
          "--non-interactive",
          "--json",
        ]);

        expect(result).toFailWith("E_VALIDATION");
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "deployment:create",
          source: "",
          code: "E_VALIDATION",
          message: "Nonexistent flag: --origin",
          next_commands: [expectedPublicCliCommand("deployment create --help")],
          details: {
            original: {
              name: "Error",
              message: "Nonexistent flag: --origin\nSee more help with --help",
            },
          },
        });
      });

      it("fails with no primary origin to deploy to", async () => {
        const app = await aSetUpApp();
        await app.removeOrigin(SETUP_ORIGIN.pattern);
        const releaseId = await aRelease(app);

        const result = await app.run([
          "deployment",
          "create",
          "--release",
          releaseId,
          "--non-interactive",
          "--json",
        ]);

        expect(result).toFailWith("E_VALIDATION");
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "deployment:create",
          source: MOCK_SERVER_URL,
          code: "E_VALIDATION",
          message: "deployment: the project has no primary origin",
          details: {
            status: 400,
            url: expect.stringMatching(DEPLOYMENTS_URL),
            body: {
              code: "dep.invalid",
              message: "deployment: the project has no primary origin",
            },
          },
        });
      });

      it("stops on Ctrl-C while the server is not answering", async () => {
        const app = await aSetUpApp();
        const releaseId = await aRelease(app);
        const waiting = platform.hangs();

        const result = app.run(["deployment", "create", "--release", releaseId, "--json"]);
        await waiting;
        pressCtrlC();

        expect(await result).toFailWith("E_CANCELLED");
        expect(app.envelopeOf(await result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "deployment:create",
          source: MOCK_SERVER_URL,
          code: "E_CANCELLED",
          message: "Cancelled",
          hint: "The command was cancelled with Ctrl-C.",
        });
      });

      it("never prints the project secret", async () => {
        const app = await aSetUpApp();
        const releaseId = await aRelease(app);

        const result = await app.run(["deployment", "create", "--release", releaseId, "--json"]);

        const { ZITADEL_PROJECT_SECRET } = await app.developmentValues();
        expect(result.stdout + result.stderr).not.toContain(ZITADEL_PROJECT_SECRET);
      });
    });

    describe("rendered for a terminal", () => {
      it.each(RENDERINGS)("headlines the release it deployed, %s", async (_how, colour) => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin("https://app.acme.com");
        const releaseId = await aRelease(app);

        const result = await asTerminal(() =>
          app.run(["deployment", "create", "--release", releaseId, "--non-interactive"], colour),
        );

        expect(result).toPrint(`Deployed ${releaseId}`);
      });

      it("names every origin it deployed to, piped", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin("https://app.acme.com");
        const releaseId = await aRelease(app);

        const result = await app.run([
          "deployment",
          "create",
          "--release",
          releaseId,
          "--non-interactive",
        ]);

        expect(result).toPrint("Live on http://localhost:3000 and https://app.acme.com.");
      });

      it("suggests listing the deployments once", async () => {
        const app = await aSetUpApp();
        const releaseId = await aRelease(app);

        const result = await app.run([
          "deployment",
          "create",
          "--release",
          releaseId,
          "--non-interactive",
        ]);

        expect(result).toSayOnce("deployment list");
      });

      it("headlines a dry run as one", async () => {
        const app = await aSetUpApp();
        const releaseId = await aRelease(app);

        const result = await app.run([
          "deployment",
          "create",
          "--release",
          releaseId,
          "--dry-run",
          "--non-interactive",
        ]);

        expect(result).toPrint(`Would deploy ${releaseId} to primary (dry run)`);
      });

      it("suggests the real deployment after a dry run, once", async () => {
        const app = await aSetUpApp();
        const releaseId = await aRelease(app);

        const result = await app.run([
          "deployment",
          "create",
          "--release",
          releaseId,
          "--dry-run",
          "--non-interactive",
        ]);

        expect(result).toSayOnce(`deployment create --release ${releaseId}`);
      });

      it("spells out an escape sequence the server put in an origin", async () => {
        const app = await aSetUpApp();
        const releaseId = await aRelease(app);
        platform.servesAHostileOrigin();

        const result = await app.run([
          "deployment",
          "create",
          "--release",
          releaseId,
          "--non-interactive",
        ]);

        expect(result).toPrint("Live on https://app.acme.com\\x1b[2Jwiped.");
        expect(result.stdout + result.stderr).not.toContain("\u001b[2J");
      });

      it("explains a refusal with the message the envelope carries", async () => {
        const app = await aSetUpApp();

        const result = await app.run([
          "deployment",
          "create",
          "--release",
          "dep_01KX5N7C9D2E7F0N9WD3P2E4YM6",
        ]);

        expect(result).toSay(
          "Invalid --release: must be a release ID: rel_ followed by letters, digits, _ or -",
        );
      });
    });
  });
});
