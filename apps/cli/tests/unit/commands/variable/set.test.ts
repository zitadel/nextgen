import { describe, expect, it } from "vitest";

import { refusePreviewOfSecret } from "../../../../src/commands/variable/set";
import { VariableService } from "../../../../src/lib/backend";
import { unscopedCommand } from "../../../../src/lib/suggestion";
import { ForbiddenError } from "../../../../src/lib/backend/errors";

function refuseFor(getVariables: () => Promise<Record<string, { primary?: unknown }>>) {
  const variableService = new VariableService({ getVariables } as never, "proj_1");
  return refusePreviewOfSecret(variableService, "API_KEY", (command) => {
    return unscopedCommand(command, "1.0.0");
  });
}

describe("refusePreviewOfSecret", () => {
  it("passes a name whose primary value is plain", async () => {
    await expect(
      refuseFor(async () => {
        return {
          API_KEY: {
            primary: "x",
          },
        };
      }),
    ).resolves.toBeUndefined();
  });

  it("refuses a name whose primary value is a secret, suggesting the piped form", async () => {
    await expect(
      refuseFor(async () => {
        return {
          API_KEY: {
            primary: {
              secret: true,
            },
          },
        };
      }),
    ).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: "API_KEY is a secret, so its preview value must be one too.",
      nextCommands: [expect.stringContaining("variable set API_KEY --secret --preview")],
    });
  });

  it("leaves the check to whoever can read the primary values on a 403", async () => {
    await expect(
      refuseFor(async () => {
        throw new ForbiddenError("Forbidden", {
          status: 403,
        });
      }),
    ).resolves.toBeUndefined();
  });

  it("fails on any other error, since writing on an unknown is the outcome it guards against", async () => {
    await expect(
      refuseFor(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });
});
