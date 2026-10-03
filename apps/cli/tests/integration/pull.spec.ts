import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { anApp, aSetUpApp, type ScaffoldedApp } from "../helpers/project";

const platform = usePlatformMock();

const LOCAL_SCHEMA_FILE = ".zitadel/schemas/default-human-user.json";

/**
 * A fresh working copy of an existing project: a new directory carrying the same
 * `.zitadel/secret`, the way a second developer who cloned the repo reaches it.
 * `pull` fills its empty `.zitadel/` from the server.
 */
async function aFreshCheckoutOf(project: ScaffoldedApp): Promise<ScaffoldedApp> {
  const checkout = await anApp();
  await checkout.writeLocalSecret("placeholder");
  await checkout.writeProjectFile(".zitadel/secret", await project.readProjectFile(".zitadel/secret"));
  return checkout;
}

/** Object type of the scaffolded schema, the handle a schema is pulled by. */
async function objectTypeOf(project: ScaffoldedApp): Promise<string> {
  return JSON.parse(await project.readProjectFile(LOCAL_SCHEMA_FILE)).objectType as string;
}

describe("pull", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.run(["pull", "schema", "human-user", "--json"]);

        expect(result).toFailWith("E_NOT_FOUND");
      });
    });

    describe("that is down", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.run(["pull", "schema", "human-user", "--json"]);

        expect(result).toFailWith("E_NETWORK");
      });
    });
  });

  describe("against a valid server", () => {
    describe("--json", () => {
      it("imports a flow a fresh checkout does not have", async () => {
        const project = await aSetUpApp();
        const flowName = (await project.publishedFlow()).flow_definition.name;
        const checkout = await aFreshCheckoutOf(project);

        const result = await checkout.run(["pull", "flow", flowName, "--json"]);

        expect(result).toSucceed();
        expect(checkout.envelopeOf(result).data).toMatchObject({
          kind: "flow",
          handle: flowName,
          path: `.zitadel/flows/${flowName}.json`,
        });
        expect(await checkout.hasProjectFile(`.zitadel/flows/${flowName}.json`)).toBe(true);
        // This checkout never ran setup, so there is no state file and plan
        // would fail — so it is not suggested.
        expect(checkout.envelopeOf<{ next_commands: string[] }>(result).data.next_commands).toEqual(
          [],
        );
      });

      it("imports a schema by object type", async () => {
        const project = await aSetUpApp();
        const objectType = await objectTypeOf(project);
        const checkout = await aFreshCheckoutOf(project);

        const result = await checkout.run(["pull", "schema", objectType, "--json"]);

        expect(result).toSucceed();
        expect(await checkout.hasProjectFile(`.zitadel/schemas/${objectType}.json`)).toBe(true);
      });

      it("writes nothing under --dry-run", async () => {
        const project = await aSetUpApp();
        const objectType = await objectTypeOf(project);
        const checkout = await aFreshCheckoutOf(project);

        const result = await checkout.run(["pull", "schema", objectType, "--dry-run", "--json"]);

        expect(checkout.envelopeOf<{ dry_run: boolean }>(result).data.dry_run).toBe(true);
        expect(await checkout.hasProjectFile(`.zitadel/schemas/${objectType}.json`)).toBe(false);
      });

      it("records the pulled revision so a follow-up plan reports it in sync", async () => {
        // A configured project whose flow is pinned to a concrete schema id on
        // the server. Pulling rewrites the id to the handle and must record the
        // revision, or plan would see the rewritten file as an upload.
        const project = await aSetUpApp();
        const schemaId = (await project.publishedSchema()).id;
        await project.editLoginFlow((flow) => {
          (flow as unknown as { user_schema: string }).user_schema = schemaId;
        });
        expect(await project.apply()).toSucceed();
        const flowName = (await project.publishedFlow()).flow_definition.name;

        const result = await project.run(["pull", "flow", flowName, "--json"]);
        expect(result).toSucceed();
        // A configured project has a state file, so plan is recorded and suggested.
        expect(
          project.envelopeOf<{ next_commands: string[] }>(result).data.next_commands,
        ).not.toEqual([]);

        expect((await project.plan()).total).toBe(0);
      });

      it("fails when the handle names nothing on the server", async () => {
        const checkout = await aFreshCheckoutOf(await aSetUpApp());

        const result = await checkout.run(["pull", "flow", "no-such-flow", "--json"]);

        expect(result).toFailWith("E_NOT_FOUND");
      });

      it("rejects a handle that is not a single path segment", async () => {
        const checkout = await aFreshCheckoutOf(await aSetUpApp());

        const result = await checkout.run(["pull", "schema", "../escape", "--json"]);

        expect(result).toFailWith("E_VALIDATION");
      });

      it("refuses a kind whose syncer cannot pull", async () => {
        const checkout = await aFreshCheckoutOf(await aSetUpApp());

        const result = await checkout.run(["pull", "branding", "default", "--json"]);

        expect(result).toFailWith("E_VALIDATION");
      });
    });

    describe("rendered for a terminal", () => {
      it("prints the path it wrote", async () => {
        const project = await aSetUpApp();
        const objectType = await objectTypeOf(project);
        const checkout = await aFreshCheckoutOf(project);

        const result = await checkout.run(["pull", "schema", objectType]);

        expect(result).toSucceed();
        expect(result.stdout).toContain(`.zitadel/schemas/${objectType}.json`);
      });
    });
  });
});
