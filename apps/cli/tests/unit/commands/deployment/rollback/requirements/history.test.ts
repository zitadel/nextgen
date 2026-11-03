import { describe, expect, it } from "vitest";

import { primaryHistory } from "../../../../../../src/commands/deployment/rollback/requirements/history";

function deployment(id: string, expiresAt: string | null) {
  return {
    id,
    targets: [{ origin: "https://app.test", expires_at: expiresAt }],
  } as never;
}

describe("primaryHistory", () => {
  it("reads nothing when a deployment is named", async () => {
    const history = await primaryHistory("dep_1", () => Promise.reject(new Error("read")));

    expect(history).toEqual({ latest: undefined, prior: undefined });
  });

  it("is the two newest primary deployments, leaving previews out", async () => {
    const history = await primaryHistory(undefined, async () => [
      deployment("preview", "2030-01-01T00:00:00Z"),
      deployment("newest", null),
      deployment("older", null),
    ]);

    expect(history).toMatchObject({ latest: { id: "newest" }, prior: { id: "older" } });
  });

  it("is a refusal when nothing has been deployed", async () => {
    expect(await primaryHistory(undefined, async () => [])).toBeUndefined();
  });
});
