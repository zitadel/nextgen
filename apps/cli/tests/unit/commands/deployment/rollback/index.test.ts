import { describe, expect, it } from "vitest";

import DeploymentRollback, {
  type History,
  readPrimaryHistory,
  readRollbackTarget,
} from "../../../../../src/commands/deployment/rollback/index";
import { parseFlag } from "../../../../helpers/inputs";

function deployment(id: string, expiresAt: string | null) {
  return {
    id,
    targets: [
      {
        origin: "https://app.test",
        expires_at: expiresAt,
      },
    ],
  } as never;
}

/** Stands in for the command's own builder, which puts the environment selector back on. */
function suggest(command: string) {
  return command as never;
}

function history(given: string | undefined, deployments: readonly unknown[]) {
  return readPrimaryHistory(
    given,
    async () => {
      return deployments as never;
    },
    suggest,
  );
}

const NONE: History = {
  latest: undefined,
  prior: undefined,
};

describe("the deployments a rollback decides from", () => {
  it("reads nothing when a deployment is named", async () => {
    await expect(history("dep_1", [])).resolves.toEqual(NONE);
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

  it("refuses when nothing has been deployed", async () => {
    await expect(history(undefined, [])).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: "There is no deployment to roll back",
    });
  });
});

describe("the deployment a rollback re-applies", () => {
  it("takes a named deployment as given, with no guard", () => {
    expect(readRollbackTarget("dep_1", NONE, suggest)).toEqual({
      id: "dep_1",
      expectedDeploymentId: undefined,
    });
  });

  it("is the deployment before the latest, guarding on the latest", () => {
    expect(
      readRollbackTarget(
        undefined,
        {
          latest: deployment("newest", null),
          prior: deployment("older", null),
        },
        suggest,
      ),
    ).toEqual({
      id: "older",
      expectedDeploymentId: "newest",
    });
  });

  it("refuses when nothing came before the latest", () => {
    expect(() => {
      readRollbackTarget(
        undefined,
        {
          latest: deployment("only", null),
          prior: undefined,
        },
        suggest,
      );
    }).toThrow(
      expect.objectContaining({
        code: "E_VALIDATION",
        message: "There is no earlier deployment to roll back to",
      }),
    );
  });
});

describe("-m", () => {
  it("trims a message", async () => {
    await expect(
      parseFlag(DeploymentRollback.flags.message, "  rolled back  ", "message"),
    ).resolves.toBe("rolled back");
  });

  it("refuses a blank message", async () => {
    await expect(
      parseFlag(DeploymentRollback.flags.message, "   ", "message"),
    ).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: "the value is empty",
    });
  });

  it("refuses a message longer than the server records, naming the limit", async () => {
    await expect(
      parseFlag(DeploymentRollback.flags.message, "x".repeat(1025), "message"),
    ).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: "the message is longer than 1024 characters",
      hint: "Pass a shorter summary with -m.",
    });
  });
});
