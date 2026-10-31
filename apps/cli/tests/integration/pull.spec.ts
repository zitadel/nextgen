import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { anApp, anUndeployedEnvironment, aSetUpApp, type ScaffoldedApp } from "../helpers/project";

const platform = usePlatformMock();

/**
 * A second working copy of the same project: a fresh app directory carrying the
 * project's `.zitadel/secret` but none of its resource files, the way a
 * developer who cloned the repo reaches a project someone else deployed.
 */
async function aFreshCheckoutOf(project: ScaffoldedApp): Promise<ScaffoldedApp> {
  const checkout = await anApp();
  await checkout.writeLocalSecret("placeholder");
  await checkout.writeProjectFile(
    ".zitadel/secret",
    await project.readProjectFile(".zitadel/secret"),
  );
  return checkout;
}

describe("pull", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        expect(await app.run(["pull", "--json"])).toFail();
      });
    });

    describe("that is down", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        expect(await app.run(["pull", "--json"])).toFail();
      });
    });
  });

  describe("against a valid server", () => {
    describe("--json", () => {
      it("rebuilds the live release into a fresh checkout", async () => {
        const project = await aSetUpApp();
        await project.deployData();
        const checkout = await aFreshCheckoutOf(project);

        expect(await checkout.run(["pull", "--json"])).toSucceed();
      });

      it("rebuilds a .zitadel the fresh checkout can deploy back", async () => {
        const project = await aSetUpApp();
        await project.deployData();
        const checkout = await aFreshCheckoutOf(project);
        await checkout.run(["pull", "--json"]);

        expect(await checkout.deploy()).toSucceed();
      });

      it("pulls the release a release id names", async () => {
        const project = await aSetUpApp();
        const deployed = await project.deployData();
        const checkout = await aFreshCheckoutOf(project);

        expect(await checkout.run(["pull", deployed.release_id ?? "", "--json"])).toSucceed();
      });

      it("pulls the release a deployment id names", async () => {
        const project = await aSetUpApp();
        const deployed = await project.deployData();
        const checkout = await aFreshCheckoutOf(project);

        expect(await checkout.run(["pull", deployed.deployment_id ?? "", "--json"])).toSucceed();
      });

      it("fails when nothing is deployed to pull", async () => {
        const project = await anUndeployedEnvironment();

        expect(await project.run(["pull", "--env", "staging", "--json"])).toFailWith("E_NOT_FOUND");
      });

      it("rejects a target that is neither latest nor an id", async () => {
        const project = await aSetUpApp();

        expect(await project.run(["pull", "whatever", "--json"])).toFailWith("E_VALIDATION");
      });

      it("writes nothing a dry run could deploy", async () => {
        const project = await aSetUpApp();
        await project.deployData();
        const checkout = await aFreshCheckoutOf(project);

        expect(await checkout.run(["pull", "--dry-run", "--json"])).toSucceed();

        expect(await checkout.deploy()).toFail();
      });
    });

    describe("rendered for a terminal", () => {
      it("says what it wrote", async () => {
        const project = await aSetUpApp();
        await project.deployData();
        const checkout = await aFreshCheckoutOf(project);

        expect(await checkout.run(["pull"])).toPrint(".zitadel/");
      });
    });
  });
});
