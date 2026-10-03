import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { anApp, aSetUpApp, type ScaffoldedApp } from "../helpers/project";

const platform = usePlatformMock();

const LOCAL_SCHEMA_FILE = ".zitadel/schemas/default-human-user.json";

/**
 * A fresh working copy of an existing project: a new directory carrying the same
 * `.zitadel/secret`, the way a second developer who cloned the repo reaches it.
 */
async function aFreshCheckoutOf(project: ScaffoldedApp): Promise<ScaffoldedApp> {
  const checkout = await anApp();
  await checkout.writeLocalSecret("placeholder");
  await checkout.writeProjectFile(".zitadel/secret", await project.readProjectFile(".zitadel/secret"));
  return checkout;
}

describe("pull", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        expect(await app.run(["pull", "schema", "human-user", "--json"])).toFailWith("E_NOT_FOUND");
      });
    });

    describe("that is down", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        expect(await app.run(["pull", "schema", "human-user", "--json"])).toFailWith("E_NETWORK");
      });
    });
  });

  describe("against a valid server", () => {
    describe("--json", () => {
      it("imports a flow a fresh checkout does not have", async () => {
        const project = await aSetUpApp();
        const flowName = (await project.publishedFlow()).flow_definition.name;
        const checkout = await aFreshCheckoutOf(project);

        expect(await checkout.run(["pull", "flow", flowName, "--json"])).toSucceed();

        expect(await checkout.hasProjectFile(`.zitadel/flows/${flowName}.json`)).toBe(true);
      });

      it("imports a schema by object type", async () => {
        const project = await aSetUpApp();
        const objectType = JSON.parse(await project.readProjectFile(LOCAL_SCHEMA_FILE)).objectType as string;
        const checkout = await aFreshCheckoutOf(project);

        expect(await checkout.run(["pull", "schema", objectType, "--json"])).toSucceed();

        expect(await checkout.hasProjectFile(`.zitadel/schemas/${objectType}.json`)).toBe(true);
      });

      it("records the pulled revision, so a follow-up plan reports it in sync", async () => {
        const project = await aSetUpApp();
        await project.pinLoginFlowToPublishedSchema();
        const flowName = (await project.publishedFlow()).flow_definition.name;

        expect(await project.run(["pull", "flow", flowName, "--json"])).toSucceed();

        expect((await project.plan()).total).toBe(0);
      });
    });

    describe("rendered for a terminal", () => {
      it("prints the path it wrote", async () => {
        const project = await aSetUpApp();
        const objectType = JSON.parse(await project.readProjectFile(LOCAL_SCHEMA_FILE)).objectType as string;
        const checkout = await aFreshCheckoutOf(project);

        const result = await checkout.run(["pull", "schema", objectType]);

        expect(result).toSucceed();
        expect(result.stdout).toContain(`.zitadel/schemas/${objectType}.json`);
      });
    });
  });
});
