import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import { onTerminalReadingAFile } from "@tests/helpers/terminal";
import { anUndeployedEnvironment, aSetUpApp } from "@tests/helpers/project";

const platform = usePlatformMock();

describe("variable resolve", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.resolveVariables();

        expect(result).toFailWith("E_NOT_FOUND");
      });
    });

    describe("that is down", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.resolveVariables();

        expect(result).toFailWith("E_NETWORK");
      });
    });

    describe("that refuses connections", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.refusesConnections();

        const result = await app.resolveVariables();

        expect(result).toFailWith("E_NETWORK");
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
      });

      it("resolves the variables the live deployment froze", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.setVariable("HOST", "app.acme.com");
        await app.deployData();

        const result = await app.resolveVariables();

        expect(result).toSucceed();
        const data = app.envelopeOf<{ items: { name: string }[] }>(result).data;
        expect(data.items.map((item) => item.name)).toContain("HOST");
      });

      it("is a miss for an origin with nothing deployed", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.deployData();

        const result = await app.resolveVariables({ origin: "https://not-deployed.acme.com" });

        expect(result).toFailWith("E_NOT_FOUND");
      });

      it("suggests listing the origins for a URL that is none of them", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.deployData();

        const result = await app.resolveVariables({ origin: "https://typo.acme.com" });

        expect(result).toSuggest("origin list");
      });

      it("suggests deploying to a primary origin added since the last deploy", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin("https://a.example.com");
        await app.addPrimaryOrigin("https://b.example.com");
        await app.deployData();
        await app.addPrimaryOrigin("https://c.example.com");

        const result = await app.resolveVariables({ origin: "https://c.example.com" });

        expect(result).toSuggest("deploy");
      });

      it("suggests no deploy for a preview origin, which only a preview build serves", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.addOrigin("https://*-acme.vercel.app", "preview");
        await app.deployData();

        const result = await app.resolveVariables({ origin: "https://pr-7-acme.vercel.app" });

        expect(result).not.toSuggest("deploy");
      });
    });

    describe("a named deployment", () => {
      it("reads the variables that deployment froze, not the ones set since", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.setVariable("HOST", "app.acme.com");
        const deployed = await app.deployData();
        await app.setVariable("LATER", "set after the deploy");

        const result = await app.resolveVariables({ deploymentId: deployed.deployment_id });

        expect(result).toSucceed();
        const data = app.envelopeOf<{ deployment_id: string; items: { name: string }[] }>(
          result,
        ).data;
        expect(data.deployment_id).toBe(deployed.deployment_id);
        expect(data.items.map((item) => item.name)).toContain("HOST");
        expect(data.items.map((item) => item.name)).not.toContain("LATER");
      });

      it("is a miss for a deployment the project does not have", async () => {
        const app = await aSetUpApp();

        const result = await app.resolveVariables({
          deploymentId: "dep_01KX5N7C9D2E7F0N9WD3P2E4YM6",
        });

        expect(result).toFailWith("E_NOT_FOUND");
      });

      it("is refused together with an origin", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        const deployed = await app.deployData();

        const result = await app.resolveVariables({
          deploymentId: deployed.deployment_id,
          origin: "https://app.acme.com",
        });

        expect(result).toFailWith("E_VALIDATION");
      });

      it("holds its invariants in every rendering", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.setVariable("BANNER", "a\u001b[2Jwiped");
        const deployed = await app.deployData();
        platform.servesAHostileOrigin();
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

        expect(result).toPrintPlainRow("HOST", "app.acme.com");
      });
    });

    describe("on a terminal", () => {
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
      });
    });
  });
});
