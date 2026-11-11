import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import { anUndeployedEnvironment, aSetUpApp } from "@tests/helpers/project";
import { cliVersion, expectedPublicCliCommand, pressCtrlC } from "@tests/helpers/run-cli";
import { asTerminal, offTerminal, onTerminalReadingAFile } from "@tests/helpers/terminal";

const platform = usePlatformMock();

const LIVE_ORIGINS = ["http://localhost:3000", "https://app.example.com"];

describe("variable resolve", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.resolveVariables();

        expect(result).toFailWith("E_NOT_FOUND");
        expect(JSON.parse(result.stdout)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "variable:resolve",
          source: "http://mock.zitadel.test",
          code: "E_NOT_FOUND",
          message: expect.stringMatching(
            /^GET http:\/\/mock\.zitadel\.test\/api\/v1\/deployments\?project_id=proj-[0-9a-f]+&live=true returned 404 — .* is this a Zitadel platform API\?$/,
          ),
          details: {
            status: 404,
            url: expect.stringMatching(
              /^http:\/\/mock\.zitadel\.test\/api\/v1\/deployments\?project_id=proj-[0-9a-f]+&live=true$/,
            ),
            body: { raw: "<html>not here</html>" },
          },
        });
      });
    });

    describe("that is down", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.resolveVariables();

        expect(result).toFailWith("E_NETWORK");
        expect(JSON.parse(result.stdout)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "variable:resolve",
          source: "http://mock.zitadel.test",
          code: "E_NETWORK",
          message: "down",
          details: {
            status: 503,
            url: expect.stringMatching(
              /^http:\/\/mock\.zitadel\.test\/api\/v1\/deployments\?project_id=proj-[0-9a-f]+&live=true$/,
            ),
            body: { code: "unavailable", message: "down" },
          },
        });
      });
    });

    describe("that refuses connections", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.refusesConnections();

        const result = await app.resolveVariables();

        expect(result).toFailWith("E_NETWORK");
        expect(JSON.parse(result.stdout)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "variable:resolve",
          source: "http://mock.zitadel.test",
          code: "E_NETWORK",
          message: expect.stringMatching(
            /^GET http:\/\/mock\.zitadel\.test\/api\/v1\/deployments\?project_id=proj-[0-9a-f]+&live=true got no response$/,
          ),
          hint: "Check your connection and the server URL (ZITADEL_URL or --server).",
          details: {
            url: expect.stringMatching(
              /^http:\/\/mock\.zitadel\.test\/api\/v1\/deployments\?project_id=proj-[0-9a-f]+&live=true$/,
            ),
            reason: "unreachable",
          },
        });
      });
    });

    describe("that hangs", () => {
      it("stops on Ctrl-C with one envelope and exit 130", async () => {
        const app = await aSetUpApp();
        const waiting = platform.hangs();

        const result = app.resolveVariables();
        await waiting;
        pressCtrlC();

        const cancelled = await result;
        expect(cancelled).toExitWith(130);
        expect(JSON.parse(cancelled.stdout)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "variable:resolve",
          source: "http://mock.zitadel.test",
          code: "E_CANCELLED",
          message: "Cancelled",
          hint: "The command was cancelled with Ctrl-C.",
        });
      });
    });
  });

  describe("against a valid server", () => {
    it("holds its invariants in every rendering", async () => {
      const app = await aSetUpApp();
      await app.addPrimaryOrigin();
      await app.setVariable("BANNER", "a\u001b[2Jwiped");
      await app.deployData();
      platform.servesAHostileOrigin();
      const args = ["variable", "resolve"];

      await app.inEveryRendering((how) => app.run(how.json ? [...args, "--json"] : args, how.env));
    });

    describe("--json", () => {
      it("is a miss when nothing is deployed", async () => {
        const app = await anUndeployedEnvironment();

        const result = await app.run(["variable", "resolve", "--env", "staging", "--json"]);

        expect(result).toFailWith("E_NOT_FOUND");
        expect(JSON.parse(result.stdout)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "variable:resolve",
          source: "http://mock.zitadel.test",
          code: "E_NOT_FOUND",
          message: "Nothing is deployed to the project.",
          hint: "Deploy first, then resolve its variables.",
          next_commands: [
            expectedPublicCliCommand(app.againAsRun("deploy -m '<what changed>' --env staging")),
          ],
        });
      });

      it("resolves the variables the live deployment froze, naming the deployment and its origins", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.setVariable("HOST", "app.acme.com");
        const deployed = await app.deployData();

        const result = await app.resolveVariables();

        expect(JSON.parse(result.stdout)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "variable:resolve",
          source: "http://mock.zitadel.test",
          data: {
            items: [{ name: "HOST", secret: false, value: "app.acme.com" }],
            count: 1,
            next_page_token: null,
            deployment_id: deployed.deployment_id,
            origins: LIVE_ORIGINS,
          },
          warnings: [],
        });
      });

      it("resolves the live deployment of the origin it is given", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.setVariable("HOST", "app.acme.com");
        const deployed = await app.deployData();

        const result = await app.resolveVariables({ origin: "https://app.example.com" });

        expect(JSON.parse(result.stdout)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "variable:resolve",
          source: "http://mock.zitadel.test",
          data: {
            items: [{ name: "HOST", secret: false, value: "app.acme.com" }],
            count: 1,
            next_page_token: null,
            deployment_id: deployed.deployment_id,
            origins: ["https://app.example.com"],
          },
          warnings: [],
        });
      });

      it("lists a secret as held, never its value", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.setVariable("TOKEN", "s3cret", { secret: true });
        const deployed = await app.deployData();

        const result = await app.resolveVariables();

        expect(JSON.parse(result.stdout)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "variable:resolve",
          source: "http://mock.zitadel.test",
          data: {
            items: [{ name: "TOKEN", secret: true }],
            count: 1,
            next_page_token: null,
            deployment_id: deployed.deployment_id,
            origins: LIVE_ORIGINS,
          },
          warnings: [],
        });
        expect(result.stdout + result.stderr).not.toContain("s3cret");
      });

      it("resolves nothing when the deployment froze no variables", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        const deployed = await app.deployData();

        const result = await app.resolveVariables();

        expect(JSON.parse(result.stdout)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "variable:resolve",
          source: "http://mock.zitadel.test",
          data: {
            items: [],
            count: 0,
            next_page_token: null,
            deployment_id: deployed.deployment_id,
            origins: LIVE_ORIGINS,
          },
          warnings: [],
        });
      });

      it("carries a control character in a value as it was frozen", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.setVariable("BANNER", "a\u001b[2Jwiped");
        const deployed = await app.deployData();

        const result = await app.resolveVariables();

        expect(JSON.parse(result.stdout)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "variable:resolve",
          source: "http://mock.zitadel.test",
          data: {
            items: [{ name: "BANNER", secret: false, value: "a\u001b[2Jwiped" }],
            count: 1,
            next_page_token: null,
            deployment_id: deployed.deployment_id,
            origins: LIVE_ORIGINS,
          },
          warnings: [],
        });
      });

      it("carries an origin the server answered as it was answered", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.deployData();
        const origin = platform.servesAHostileOrigin();

        const result = await app.resolveVariables();

        expect(JSON.parse(result.stdout)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "variable:resolve",
          source: "http://mock.zitadel.test",
          data: {
            items: [],
            count: 0,
            next_page_token: null,
            deployment_id: expect.stringMatching(/^dep_/),
            origins: [origin],
          },
          warnings: [],
        });
      });

      it("is a miss for an origin with nothing deployed", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.deployData();

        const result = await app.resolveVariables({ origin: "https://not-deployed.acme.com" });

        expect(result).toFailWith("E_NOT_FOUND");
        expect(JSON.parse(result.stdout)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "variable:resolve",
          source: "http://mock.zitadel.test",
          code: "E_NOT_FOUND",
          message: "https://not-deployed.acme.com is not an origin of the project.",
          hint: "Check the origin for a typo, or list the project's origins.",
          next_commands: [expectedPublicCliCommand(app.againAsRun("origin list"))],
        });
      });

      it("suggests listing the origins for a URL that is none of them", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.deployData();

        const result = await app.resolveVariables({ origin: "https://typo.acme.com" });

        expect(JSON.parse(result.stdout)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "variable:resolve",
          source: "http://mock.zitadel.test",
          code: "E_NOT_FOUND",
          message: "https://typo.acme.com is not an origin of the project.",
          hint: "Check the origin for a typo, or list the project's origins.",
          next_commands: [expectedPublicCliCommand(app.againAsRun("origin list"))],
        });
      });

      it("suggests deploying to a primary origin added since the last deploy", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin("https://a.example.com");
        await app.addPrimaryOrigin("https://b.example.com");
        await app.deployData();
        await app.addPrimaryOrigin("https://c.example.com");

        const result = await app.resolveVariables({ origin: "https://c.example.com" });

        expect(JSON.parse(result.stdout)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "variable:resolve",
          source: "http://mock.zitadel.test",
          code: "E_NOT_FOUND",
          message: "Nothing is deployed to https://c.example.com.",
          hint: "Deploy to it first, then resolve its variables.",
          next_commands: [expectedPublicCliCommand(app.againAsRun("deploy -m '<what changed>'"))],
        });
      });

      it("suggests no deploy for a preview origin, which only a preview build serves", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.addOrigin("https://*-acme.vercel.app", "preview");
        await app.deployData();

        const result = await app.resolveVariables({ origin: "https://pr-7-acme.vercel.app" });

        expect(JSON.parse(result.stdout)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "variable:resolve",
          source: "http://mock.zitadel.test",
          code: "E_NOT_FOUND",
          message: "Nothing is deployed to https://pr-7-acme.vercel.app.",
          hint: "A preview URL is served by a pull-request build, not by a deploy from here; resolve its variables once that build has deployed it.",
        });
      });
    });

    describe("a named deployment", () => {
      async function aDeployedProject() {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.setVariable("HOST", "app.acme.com");
        const deployed = await app.deployData();
        await app.setVariable("LATER", "set after the deploy");
        return { app, deploymentId: deployed.deployment_id ?? "" };
      }

      async function aSupersededProject() {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        const first = await app.deployData();
        await app.editUserSchema((schema) => {
          schema.properties.company = { type: "string" };
        });
        const second = await app.deployData();
        expect(second.release_id).not.toBe(first.release_id);
        return { app, firstDeploymentId: first.deployment_id ?? "" };
      }

      it("lists the variables that deployment froze, leaving out the ones set since", async () => {
        const { app, deploymentId } = await aDeployedProject();

        const result = await app.resolveVariables({ deploymentId });

        expect(JSON.parse(result.stdout)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "variable:resolve",
          source: "http://mock.zitadel.test",
          data: {
            items: [{ name: "HOST", secret: false, value: "app.acme.com" }],
            count: 1,
            next_page_token: null,
            deployment_id: deploymentId,
          },
          warnings: [],
        });
      });

      it("reads a deployment that is no longer live", async () => {
        const { app, firstDeploymentId } = await aSupersededProject();

        const result = await app.resolveVariables({ deploymentId: firstDeploymentId });

        expect(JSON.parse(result.stdout)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "variable:resolve",
          source: "http://mock.zitadel.test",
          data: {
            items: [],
            count: 0,
            next_page_token: null,
            deployment_id: firstDeploymentId,
          },
          warnings: [],
        });
      });

      it("is refused for a credential that may not read variables", async () => {
        const { app, deploymentId } = await aDeployedProject();
        platform.refusesVariableReads();

        const result = await app.resolveVariables({ deploymentId });

        expect(result).toFailWith("E_AUTH");
        expect(JSON.parse(result.stdout)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "variable:resolve",
          source: "http://mock.zitadel.test",
          code: "E_AUTH",
          message: "the credential may not read variables",
          details: {
            status: 403,
            url: expect.stringMatching(
              new RegExp(
                `^http://mock\\.zitadel\\.test/api/v1/deployments/${deploymentId}/variables\\?project_id=proj-[0-9a-f]+$`,
              ),
            ),
            body: {
              code: "proj.permission_denied",
              message: "the credential may not read variables",
            },
          },
        });
      });

      it("is a miss for a deployment the project does not have", async () => {
        const app = await aSetUpApp();

        const result = await app.resolveVariables({
          deploymentId: "dep_01KX5N7C9D2E7F0N9WD3P2E4YM6",
        });

        expect(result).toFailWith("E_NOT_FOUND");
        expect(JSON.parse(result.stdout)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "variable:resolve",
          source: "http://mock.zitadel.test",
          code: "E_NOT_FOUND",
          message: "deployment: not found",
          details: {
            status: 404,
            url: expect.stringMatching(
              /^http:\/\/mock\.zitadel\.test\/api\/v1\/deployments\/dep_01KX5N7C9D2E7F0N9WD3P2E4YM6\/variables\?project_id=proj-[0-9a-f]+$/,
            ),
            body: { code: "dep.not_found", message: "deployment: not found" },
          },
        });
      });

      it("is refused for a value that is no deployment id, pointing at the deployment list", async () => {
        const app = await aSetUpApp();

        const result = await app.resolveVariables({ deploymentId: "xx" });

        expect(result).toFailWith("E_VALIDATION");
        expect(JSON.parse(result.stdout)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "variable:resolve",
          source: "",
          code: "E_VALIDATION",
          message:
            "Invalid deployment_id: must be a deployment ID: dep_ followed by letters, digits, _ or -",
          hint: `Find one with ${expectedPublicCliCommand("deployment list")}, or omit it to read the live deployment.`,
          next_commands: [expectedPublicCliCommand("deployment list")],
          details: { argument: "deployment_id" },
        });
      });

      it("is refused together with an origin", async () => {
        const { app, deploymentId } = await aDeployedProject();

        const result = await app.resolveVariables({
          deploymentId,
          origin: "https://app.acme.com",
        });

        expect(result).toFailWith("E_VALIDATION");
        expect(JSON.parse(result.stdout)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "variable:resolve",
          source: "http://mock.zitadel.test",
          code: "E_VALIDATION",
          message: "Name a deployment or an origin, not both.",
          hint: "A deployment id already says which deployment to read; --origin only picks the live one.",
        });
      });

      it("holds its invariants in every rendering", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.setVariable("BANNER", "a\u001b[2Jwiped");
        const deployed = await app.deployData();
        const args = ["variable", "resolve", deployed.deployment_id ?? ""];

        await app.inEveryRendering((how) =>
          app.run(how.json ? [...args, "--json"] : args, how.env),
        );
      });
    });

    describe("--plain", () => {
      it("prints each frozen variable as a tab-separated record", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.setVariable("HOST", "app.acme.com");
        await app.deployData();

        const result = await app.run(["variable", "resolve", "--plain"]);

        expect(result).toPrintPlainRows(["HOST", "app.acme.com"]);
      });

      it("prints a secret as held, never its value", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.setVariable("TOKEN", "s3cret", { secret: true });
        await app.deployData();

        const result = await app.run(["variable", "resolve", "--plain"]);

        expect(result).toPrintPlainRows(["TOKEN", "(secret)"]);
        expect(result.stdout + result.stderr).not.toContain("s3cret");
      });
    });

    describe("piped", () => {
      it("prints the frozen variables as records", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.setVariable("HOST", "app.acme.com");
        await app.deployData();

        const result = await offTerminal(() => app.resolveVariables({ json: false }));

        expect(result).toPrintPlainRows(["HOST", "app.acme.com"]);
      });
    });

    describe("on a terminal", () => {
      it("names the deployment and the origins it froze them for", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.setVariable("HOST", "app.acme.com");
        const deployed = await app.deployData();

        const result = await asTerminal(() => app.resolveVariables({ json: false }));

        expect(result).toPrint(
          `Frozen by ${deployed.deployment_id} for http://localhost:3000, https://app.example.com`,
        );
      });

      it("names the deployment alone when one was named", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.setVariable("HOST", "app.acme.com");
        const deployed = await app.deployData();

        const result = await asTerminal(() =>
          app.resolveVariables({ json: false, deploymentId: deployed.deployment_id }),
        );

        expect(result).toPrint(`Frozen by ${deployed.deployment_id}`);
      });

      it("never prints a secret's value", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.setVariable("TOKEN", "s3cret", { secret: true });
        await app.deployData();

        const result = await asTerminal(() => app.resolveVariables({ json: false }));

        expect(result).toPrintRow("TOKEN", "(secret)");
        expect(result.stdout + result.stderr).not.toContain("s3cret");
      });

      it("spells out the origin the footer names, which the server answered with", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.setVariable("HOST", "app.acme.com");
        await app.deployData();
        const origin = platform.servesAHostileOrigin();

        const result = await onTerminalReadingAFile(() => {
          return app.resolveVariables({ json: false });
        });

        expect(result).toSucceed();
        expect(result.stdout).toContain(`Frozen by `);
        expect(result.stdout).toContain(origin.replace("\u001b", "\\x1b"));
        expect(result.stdout).not.toContain("\u001b[2J");
      });

      it("spells out the origin the empty line names, which the server answered with", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.deployData();
        const origin = platform.servesAHostileOrigin();

        const result = await onTerminalReadingAFile(() => {
          return app.resolveVariables({ json: false });
        });

        expect(result).toSucceed();
        expect(result.stdout).toContain(`froze no variables for`);
        expect(result.stdout).toContain(origin.replace("\u001b", "\\x1b"));
        expect(result.stdout).not.toContain("\u001b[2J");
      });

      it("says the deployment froze no variables, when it froze none", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        const deployed = await app.deployData();

        const result = await asTerminal(() => app.resolveVariables({ json: false }));

        expect(result).toPrint(
          `${deployed.deployment_id} froze no variables for http://localhost:3000, https://app.example.com`,
        );
      });
    });
  });
});
