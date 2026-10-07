import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { aSetUpApp } from "../helpers/project";

usePlatformMock();

type Deployment = {
  id: string;
  release_id: string;
  targets: Array<{ origin: string }>;
  metadata: { reason?: string };
};
type Serving = { origin: string; release_id: string; deployment_id: string };

describe("deployment list", () => {
  it("lists the deployments newest first, starting with setup's first one", async () => {
    const app = await aSetUpApp();

    const result = await app.run(["deployment", "list", "--json"]);

    expect(result).toSucceed();
    const { data } = app.envelopeOf<{ deployments: Deployment[]; count: number }>(result);
    expect(data.count).toBeGreaterThanOrEqual(1);
    // Setup's first deployment covers the default and the local origin.
    const first = data.deployments[0];
    expect(first?.id).toMatch(/^dep_/);
    expect(first?.targets.map((target) => target.origin).sort()).toEqual(["", "http://localhost:3000"]);
  });

  it("shows one row per target with --live", async () => {
    const app = await aSetUpApp();
    expect(await app.run(["deploy", "--non-interactive", "--json"])).toSucceed();

    const result = await app.run(["deployment", "list", "--live", "--json"]);

    const rows = app.envelopeOf<{ targets: Serving[] }>(result).data.targets;
    expect(rows.map((row) => row.origin).sort()).toEqual(["", "http://localhost:3000"]);
    expect(new Set(rows.map((row) => row.deployment_id)).size).toBe(1);
  });

  it("narrows to the deployments that touched one target with --origin default", async () => {
    const app = await aSetUpApp();

    const result = await app.run(["deployment", "list", "--origin", "default", "--json"]);

    const rows = app.envelopeOf<{ deployments: Deployment[] }>(result).data.deployments;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.every((row) => row.targets.some((target) => target.origin === ""))).toBe(true);
  });

  it("renders the default target as (default) for a person", async () => {
    const app = await aSetUpApp();

    const result = await app.run(["deployment", "list", "--plain"]);

    expect(result).toSucceed();
    expect(result.stdout).toContain("(default)");
  });
});
