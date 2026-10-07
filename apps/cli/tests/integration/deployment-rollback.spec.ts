import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { aSetUpApp, type ScaffoldedApp } from "../helpers/project";

usePlatformMock();

type Row = { origin: string; release_id: string; deployment_id: string };

async function serving(app: ScaffoldedApp, origin: string): Promise<Row | undefined> {
  const live = await app.run(["deployment", "list", "--live", "--json"]);
  return app.envelopeOf<{ targets: Row[] }>(live).data.targets.find(
    (row) => row.origin === origin,
  );
}

describe("deployment rollback", () => {
  it("needs --force when non-interactive", async () => {
    const app = await aSetUpApp();

    expect(await app.run(["deployment", "rollback", "--non-interactive", "--json"])).toFailWith("E_VALIDATION");
  });

  it("undoes the newest deployment on every target it moved", async () => {
    const app = await aSetUpApp();
    const first = await serving(app, "");
    await app.editUserSchema((schema) => {
      schema.properties.nickname = { type: "string" };
    });
    expect(await app.run(["deploy", "--non-interactive", "--json"])).toSucceed();
    const second = await serving(app, "");
    expect(second?.deployment_id).not.toBe(first?.deployment_id);

    const result = await app.run(["deployment", "rollback", "--non-interactive", "--force", "--json"]);

    expect(result).toSucceed();
    const { data } = app.envelopeOf<{ deployment_id: string; targets: string[] }>(result);
    expect(data.deployment_id).toMatch(/^dep_/);
    expect(data.targets).toContain("");
    const restored = await serving(app, "");
    expect(restored?.release_id).toBe(first?.release_id);
    expect(restored?.deployment_id).toBe(data.deployment_id);
  });

  it("changes nothing on a dry run", async () => {
    const app = await aSetUpApp();
    const before = await serving(app, "");

    expect(await app.run(["deployment", "rollback", "--non-interactive", "--dry-run", "--json"])).toSucceed();

    expect((await serving(app, ""))?.deployment_id).toBe(before?.deployment_id);
  });
});
