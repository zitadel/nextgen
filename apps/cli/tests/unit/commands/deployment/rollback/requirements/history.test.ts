import { describe, expect, it } from "vitest";

import { deploymentHistory } from "../../../../../../src/commands/deployment/rollback/requirements/history";
import { requirementContext } from "../../../../../helpers/requirement-context";

function deployment(id: string, expiresAt: string | null) {
  return {
    id,
    targets: [
      {
        origin: "https://app.test",
        expires_at: expiresAt,
      },
    ],
  };
}

function history(given: string | undefined, deployments: readonly unknown[]) {
  return deploymentHistory.resolve(
    requirementContext({
      args: {
        deploymentId: given,
      },
      connect: async () => {
        return {
          projectId: "prj_1",
          client: {
            listDeployments: {
              all: async () => {
                return deployments;
              },
            },
          },
        } as never;
      },
    }),
  );
}

describe("the deployments a rollback decides from", () => {
  it("reads nothing when a deployment is named", async () => {
    await expect(history("dep_1", [])).resolves.toEqual({
      latest: undefined,
      prior: undefined,
    });
  });

  it("is the two newest primary deployments, leaving previews out", async () => {
    await expect(
      history(undefined, [
        deployment("preview", "2030-01-01T00:00:00Z"),
        deployment("newest", null),
        deployment("older", null),
      ]),
    ).resolves.toMatchObject({
      latest: {
        id: "newest",
      },
      prior: {
        id: "older",
      },
    });
  });

  it("is a refusal when nothing has been deployed", async () => {
    await expect(history(undefined, [])).resolves.toBeUndefined();
  });
});
