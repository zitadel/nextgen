import { describe, expect, it } from "vitest";

import { Deployment, DeploymentService } from "../../../../src/lib/backend/deployment-service";

describe("Deployment.servesPrimary", () => {
  it("is true for a deployment with an unexpiring target", () => {
    expect(
      Deployment.of({
        targets: [{ origin: "https://a", expires_at: null }],
      } as never).servesPrimary,
    ).toBe(true);
  });

  it("is false for a preview deployment", () => {
    expect(
      Deployment.of({
        targets: [{ origin: "https://pr-1", expires_at: "2026-12-01T00:00:00Z" }],
      } as never).servesPrimary,
    ).toBe(false);
  });
});

function deployment(id: string, expiresAt: string | null) {
  return {
    id,
    targets: [{ origin: "https://app.test", expires_at: expiresAt }],
  };
}

function serviceHolding(deployments: readonly unknown[]): DeploymentService {
  const client = { listDeployments: { all: async () => deployments } };
  return new DeploymentService(client as never, "proj_1");
}

describe("DeploymentService.planRollback", () => {
  it("takes a named deployment as given, with no guard, and reads nothing", async () => {
    await expect(serviceHolding([]).planRollback("dep_1")).resolves.toEqual({
      outcome: "target",
      target: { id: "dep_1", expectedDeploymentId: undefined },
    });
  });

  it("re-applies the primary deployment before the latest, guarding on the latest", async () => {
    const service = serviceHolding([
      deployment("preview", "2030-01-01T00:00:00Z"),
      deployment("newest", null),
      deployment("older", null),
    ]);

    await expect(service.planRollback()).resolves.toEqual({
      outcome: "target",
      target: { id: "older", expectedDeploymentId: "newest" },
    });
  });

  it("says nothing is deployed when no primary deployment exists", async () => {
    await expect(serviceHolding([]).planRollback()).resolves.toEqual({
      outcome: "nothing-deployed",
    });
  });

  it("says nothing is earlier when only one primary deployment exists", async () => {
    await expect(serviceHolding([deployment("only", null)]).planRollback()).resolves.toEqual({
      outcome: "nothing-earlier",
    });
  });
});
