import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { aSetUpApp, type ScaffoldedApp } from "../helpers/project";

usePlatformMock();

type Row = { origin: string; release_id: string; deploy_id: string };

async function serving(app: ScaffoldedApp, origin: string): Promise<Row | undefined> {
  const live = await app.run(["deployments", "--live", "--json"]);
  return app.envelopeOf<{ deployments: Row[] }>(live).data.deployments.find(
    (row) => row.origin === origin,
  );
}

describe("rollback", () => {
  it("needs --force when non-interactive", async () => {
    const app = await aSetUpApp();

    expect(await app.run(["rollback", "--non-interactive", "--json"])).toFailWith("E_VALIDATION");
  });

  it("undoes the newest deploy on every target it moved", async () => {
    const app = await aSetUpApp();
    const first = await serving(app, "");
    await app.editUserSchema((schema) => {
      schema.properties.nickname = { type: "string" };
    });
    expect(await app.run(["deploy", "--non-interactive", "--json"])).toSucceed();
    const second = await serving(app, "");
    expect(second?.deploy_id).not.toBe(first?.deploy_id);

    const result = await app.run(["rollback", "--non-interactive", "--force", "--json"]);

    expect(result).toSucceed();
    const { data } = app.envelopeOf<{ deploy_id: string; deployments: Row[] }>(result);
    expect(data.deploy_id).toMatch(/^dpl_/);
    expect(data.deployments.map((row) => row.origin)).toContain("");
    const restored = await serving(app, "");
    expect(restored?.release_id).toBe(first?.release_id);
    expect(restored?.deploy_id).toBe(data.deploy_id);
  });

  it("changes nothing on a dry run", async () => {
    const app = await aSetUpApp();
    const before = await serving(app, "");

    expect(await app.run(["rollback", "--non-interactive", "--dry-run", "--json"])).toSucceed();

    expect((await serving(app, ""))?.deploy_id).toBe(before?.deploy_id);
  });
});
