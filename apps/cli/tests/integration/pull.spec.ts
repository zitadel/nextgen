import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import {
  aFreshCheckoutHoldingARefusedSchemaOf,
  aFreshCheckoutOf,
  anUndeployedEnvironment,
  aSetUpApp,
} from "@tests/helpers/project";

const platform = usePlatformMock();

describe("pull", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.run(["pull", "--json"]);

        expect(result).toFail();
      });
    });

    describe("that is down", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.run(["pull", "--json"]);

        expect(result).toFail();
      });
    });
  });

  describe("against a valid server", () => {
    it("holds its invariants in every rendering", async () => {
      const app = await aSetUpApp();
      await app.addPrimaryOrigin();
      await app.setVariable("HOST", "app.acme.com");
      await app.deployData();
      platform.servesAHostileOrigin();
      const args = ["pull"];

      await app.inEveryRendering((how) => {
        return app.run(how.json ? [...args, "--json"] : args, how.env);
      });
    });

    describe("--json", () => {
      it("rebuilds the live release into a fresh checkout", async () => {
        const project = await aSetUpApp();
        await project.deployData();
        const checkout = await aFreshCheckoutOf(project);

        const result = await checkout.run(["pull", "--json"]);

        expect(result).toSucceed();
      });

      it("rebuilds a .zitadel the fresh checkout can deploy back", async () => {
        const project = await aSetUpApp();
        await project.deployData();
        const checkout = await aFreshCheckoutOf(project);

        await checkout.run(["pull", "--json"]);

        expect(await checkout.deploy()).toSucceed();
      });

      it("succeeds over a local schema its contract refuses", async () => {
        const project = await aSetUpApp();
        await project.deployData();
        const checkout = await aFreshCheckoutHoldingARefusedSchemaOf(project);

        const result = await checkout.run(["pull", "--json"]);

        expect(result).toSucceed();
      });

      it("replaces a local schema its contract refuses so the checkout deploys", async () => {
        const project = await aSetUpApp();
        await project.deployData();
        const checkout = await aFreshCheckoutHoldingARefusedSchemaOf(project);

        await checkout.run(["pull", "--json"]);

        expect(await checkout.deploy()).toSucceed();
      });

      it("pulls the release a release id names", async () => {
        const project = await aSetUpApp();
        const deployed = await project.deployData();
        const checkout = await aFreshCheckoutOf(project);

        const result = await checkout.run(["pull", deployed.release_id ?? "", "--json"]);

        expect(result).toSucceed();
      });

      it("suggests a deploy after pulling the live release", async () => {
        const project = await aSetUpApp();
        await project.deployData();
        const checkout = await aFreshCheckoutOf(project);

        const result = await checkout.run(["pull", "--json"]);

        expect(result).toSuggest("deploy");
      });

      it("suggests no deploy after pulling a release it was named", async () => {
        const project = await aSetUpApp();
        const deployed = await project.deployData();
        const checkout = await aFreshCheckoutOf(project);

        const result = await checkout.run(["pull", deployed.release_id ?? "", "--json"]);

        expect(result).not.toSuggest("deploy");
      });

      it("pulls the release a deployment id names", async () => {
        const project = await aSetUpApp();
        const deployed = await project.deployData();
        const checkout = await aFreshCheckoutOf(project);

        const result = await checkout.run(["pull", deployed.deployment_id ?? "", "--json"]);

        expect(result).toSucceed();
      });

      it("pulls the release a deployment id names with a credential that may not read variables", async () => {
        const project = await aSetUpApp();
        const deployed = await project.deployData();
        const checkout = await aFreshCheckoutOf(project);
        platform.refusesVariableReads();

        const result = await checkout.run(["pull", deployed.deployment_id ?? "", "--json"]);

        expect(result).toSucceed();
      });

      it("fails when nothing is deployed to pull", async () => {
        const project = await anUndeployedEnvironment();

        const result = await project.run(["pull", "--env", "staging", "--json"]);

        expect(result).toFailWith("E_NOT_FOUND");
      });

      it("rejects a target that is neither latest nor an id", async () => {
        const project = await aSetUpApp();

        const result = await project.run(["pull", "whatever", "--json"]);

        expect(result).toFailWith("E_VALIDATION");
      });

      describe("under --dry-run", () => {
        it("succeeds", async () => {
          const project = await aSetUpApp();
          await project.deployData();
          const checkout = await aFreshCheckoutOf(project);

          const result = await checkout.run(["pull", "--dry-run", "--json"]);

          expect(result).toSucceed();
        });

        it("writes nothing a deploy could publish", async () => {
          const project = await aSetUpApp();
          await project.deployData();
          const checkout = await aFreshCheckoutOf(project);

          await checkout.run(["pull", "--dry-run", "--json"]);

          expect(await checkout.deploy()).toFail();
        });
      });
    });

    describe("rendered for a terminal", () => {
      it("says what it wrote", async () => {
        const project = await aSetUpApp();
        await project.deployData();
        const checkout = await aFreshCheckoutOf(project);

        const result = await checkout.run(["pull"]);

        expect(result).toPrint(".zitadel/");
      });
    });
  });
});
