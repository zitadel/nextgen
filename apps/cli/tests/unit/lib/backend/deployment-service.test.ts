import { describe, expect, it } from "vitest";

import { DeploymentService } from "../../../../src/lib/backend/deployment-service";

describe("DeploymentService.servesPrimary", () => {
  it("is true for a deployment with an unexpiring target", () => {
    expect(
      DeploymentService.servesPrimary({
        targets: [{ origin: "https://a", expires_at: null }],
      } as never),
    ).toBe(true);
  });

  it("is false for a preview deployment", () => {
    expect(
      DeploymentService.servesPrimary({
        targets: [{ origin: "https://pr-1", expires_at: "2026-12-01T00:00:00Z" }],
      } as never),
    ).toBe(false);
  });
});
