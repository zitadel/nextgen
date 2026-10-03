import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { anApp, aSetUpApp, type ScaffoldedApp } from "../helpers/project";

usePlatformMock();

const LOCAL_SCHEMA_FILE = ".zitadel/schemas/default-human-user.json";

/**
 * A fresh working copy of an existing project: a new directory that carries the
 * same `.zitadel/secret`, the way a second developer who cloned the repo (or
 * the same developer on a clean checkout) reaches the project. `pull` fills its
 * empty `.zitadel/` from the server.
 */
async function aFreshCheckoutOf(project: ScaffoldedApp): Promise<ScaffoldedApp> {
  const checkout = await anApp();
  await checkout.writeLocalSecret("placeholder");
  await checkout.writeProjectFile(".zitadel/secret", await project.readProjectFile(".zitadel/secret"));
  return checkout;
}

describe("pull", () => {
  it("imports a flow from the server, rewriting its pinned schema id to a handle", async () => {
    // A project whose flow was pinned to a concrete schema revision on the
    // server — what a dashboard edit that adopted a specific schema produces.
    const project = await aSetUpApp();
    const schemaId = (await project.publishedSchema()).id;
    const objectType = JSON.parse(await project.readProjectFile(LOCAL_SCHEMA_FILE)).objectType as string;
    await project.editLoginFlow((flow) => {
      (flow as unknown as { user_schema: string }).user_schema = schemaId;
    });
    expect(await project.apply()).toSucceed();
    const published = await project.publishedFlow();
    expect(published.flow_definition.user_schema).toBe(schemaId);
    const flowName = published.flow_definition.name;

    // A clean checkout with no local flow pulls it.
    const checkout = await aFreshCheckoutOf(project);
    const result = await checkout.run(["pull", "flow", flowName, "--json"]);

    expect(result).toSucceed();
    const pulled = JSON.parse(
      await checkout.readProjectFile(`.zitadel/flows/${flowName}.json`),
    ) as { user_schema: string; name: string };
    // The concrete `sch_…` id is gone; the flow now references the schema by
    // its stable handle, so a release can resolve it against any revision.
    expect(pulled.user_schema).toBe(objectType);
    expect(pulled.user_schema.startsWith("sch_")).toBe(false);
    expect(pulled.name).toBe(flowName);
  });

  it("imports a schema by object type", async () => {
    const project = await aSetUpApp();
    const objectType = JSON.parse(await project.readProjectFile(LOCAL_SCHEMA_FILE)).objectType as string;

    const checkout = await aFreshCheckoutOf(project);
    const result = await checkout.run(["pull", "schema", objectType, "--json"]);

    expect(result).toSucceed();
    const envelope = checkout.envelopeOf<{ kind: string; handle: string; path: string }>(result);
    expect(envelope.data.kind).toBe("schema");
    expect(envelope.data.handle).toBe(objectType);
    expect(await checkout.hasProjectFile(`.zitadel/schemas/${objectType}.json`)).toBe(true);
  });

  it("writes nothing under --dry-run but still reports what it would pull", async () => {
    const project = await aSetUpApp();
    const objectType = JSON.parse(await project.readProjectFile(LOCAL_SCHEMA_FILE)).objectType as string;
    const checkout = await aFreshCheckoutOf(project);

    const result = await checkout.run(["pull", "schema", objectType, "--dry-run", "--json"]);

    expect(result).toSucceed();
    expect(checkout.envelopeOf<{ dry_run: boolean }>(result).data.dry_run).toBe(true);
    expect(await checkout.hasProjectFile(`.zitadel/schemas/${objectType}.json`)).toBe(false);
  });

  it("fails when the handle names nothing on the server", async () => {
    const project = await aSetUpApp();
    const checkout = await aFreshCheckoutOf(project);

    const result = await checkout.run(["pull", "flow", "no-such-flow", "--json"]);

    expect(result).toFailWith("E_NOT_FOUND");
  });

  it("refuses a kind that is not pullable yet", async () => {
    const project = await aSetUpApp();
    const checkout = await aFreshCheckoutOf(project);

    const result = await checkout.run(["pull", "branding", "whatever", "--json"]);

    // oclif rejects the argument before the command runs: `branding` is not an
    // offered kind, so the CLI exits non-zero.
    expect(result.exitCode).not.toBe(0);
  });
});
