import { describe, expect, it } from "vitest";

import { rollbackTarget } from "../../../../../../src/commands/deployment/rollback/requirements/target";
import { requirementContext } from "../../../../../helpers/requirement-context";

function target(given: string | undefined, history: unknown) {
  return rollbackTarget.resolve(
    requirementContext({
      args: {
        deploymentId: given,
      },
      resolved: {
        history,
      },
    }),
  );
}

const NONE = {
  latest: undefined,
  prior: undefined,
};

describe("the deployment a rollback re-applies", () => {
  it("takes a named deployment as given, with no guard", async () => {
    await expect(target("dep_1", NONE)).resolves.toEqual({
      id: "dep_1",
      expectedDeploymentId: undefined,
    });
  });

  it("is the deployment before the latest, guarding on the latest", async () => {
    await expect(
      target(undefined, {
        latest: {
          id: "newest",
        },
        prior: {
          id: "older",
        },
      }),
    ).resolves.toEqual({
      id: "older",
      expectedDeploymentId: "newest",
    });
  });

  it("is a refusal when nothing came before the latest", async () => {
    await expect(
      target(undefined, {
        latest: {
          id: "only",
        },
        prior: undefined,
      }),
    ).resolves.toBeUndefined();
  });
});
