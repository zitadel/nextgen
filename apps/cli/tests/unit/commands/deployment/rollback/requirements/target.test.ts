import { describe, expect, it } from "vitest";

import { targetFrom } from "../../../../../../src/commands/deployment/rollback/requirements/target";

const NONE = { latest: undefined, prior: undefined };

describe("targetFrom", () => {
  it("takes a named deployment as given, with no guard", () => {
    expect(targetFrom("dep_1", NONE)).toEqual({ id: "dep_1", expectedDeploymentId: undefined });
  });

  it("rolls a bare rollback back to the deployment before the latest, guarding on the latest", () => {
    const history = { latest: { id: "newest" }, prior: { id: "older" } } as never;

    expect(targetFrom(undefined, history)).toEqual({ id: "older", expectedDeploymentId: "newest" });
  });

  it("is a refusal when nothing came before the latest", () => {
    expect(
      targetFrom(undefined, { latest: { id: "only" }, prior: undefined } as never),
    ).toBeUndefined();
  });
});
