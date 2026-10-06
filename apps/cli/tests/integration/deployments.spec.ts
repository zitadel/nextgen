import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { aSetUpApp } from "../helpers/project";

usePlatformMock();

type Row = { origin: string; release_id: string; deploy_id: string; metadata: { reason?: string } };

describe("deployments", () => {
  it("lists the log newest first, starting with setup's first deploy", async () => {
    const app = await aSetUpApp();

    const result = await app.run(["deployments", "--json"]);

    expect(result).toSucceed();
    const { data } = app.envelopeOf<{ deployments: Row[]; count: number }>(result);
    expect(data.count).toBeGreaterThanOrEqual(1);
    expect(data.deployments[0]?.origin).toBe("");
  });

  it("shows one row per target with --live", async () => {
    const app = await aSetUpApp();
    expect(await app.run(["deploy", "--non-interactive", "--json"])).toSucceed();

    const result = await app.run(["deployments", "--live", "--json"]);

    const rows = app.envelopeOf<{ deployments: Row[] }>(result).data.deployments;
    expect(rows.map((row) => row.origin).sort()).toEqual(["", "http://localhost:3000"]);
  });

  it("narrows to one target's history with --origin default", async () => {
    const app = await aSetUpApp();

    const result = await app.run(["deployments", "--origin", "default", "--json"]);

    const rows = app.envelopeOf<{ deployments: Row[] }>(result).data.deployments;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.every((row) => row.origin === "")).toBe(true);
  });

  it("renders the default target as (default) for a person", async () => {
    const app = await aSetUpApp();

    const result = await app.run(["deployments", "--plain"]);

    expect(result).toSucceed();
    expect(result.stdout).toContain("(default)");
  });
});
