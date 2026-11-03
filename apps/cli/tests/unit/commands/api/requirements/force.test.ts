import { describe, expect, it } from "vitest";

import { apiForce } from "../../../../../src/commands/api/requirements/force";
import { requirementContext } from "../../../../helpers/requirement-context";

function request(input: { destructive: boolean; body: unknown }) {
  return {
    operation: {
      id: "deleteUser",
      destructive: input.destructive,
    },
    body: input.body,
  };
}

function forced(
  request: unknown,
  run: { dryRun?: boolean; nonInteractive?: boolean; force?: boolean } = {},
) {
  return apiForce.resolve(
    requirementContext({
      meta: {
        dryRun: run.dryRun ?? false,
        nonInteractive: run.nonInteractive ?? false,
        force: run.force ?? false,
      },
      resolved: {
        payload: {
          request,
        },
      },
    }),
  );
}

describe("--force on a call that cannot be asked about", () => {
  it("is required for a destructive call with a body nobody can be asked about", async () => {
    await expect(
      forced(request({ destructive: true, body: { name: "a" } }), { nonInteractive: true }),
    ).resolves.toEqual({ unmet: { operation: "deleteUser" } });
  });

  it("is satisfied once it is given", async () => {
    await expect(
      forced(request({ destructive: true, body: { name: "a" } }), {
        nonInteractive: true,
        force: true,
      }),
    ).resolves.toEqual({ forced: true });
  });

  it("is not required on a terminal, where the person is asked instead", async () => {
    await expect(forced(request({ destructive: true, body: { name: "a" } }))).resolves.toEqual({
      forced: false,
    });
  });

  it("is not required by a dry run, which calls nothing", async () => {
    await expect(
      forced(request({ destructive: true, body: { name: "a" } }), {
        nonInteractive: true,
        dryRun: true,
      }),
    ).resolves.toEqual({ forced: false });
  });

  it("is not required by a call that is not destructive", async () => {
    await expect(
      forced(request({ destructive: false, body: { name: "a" } }), { nonInteractive: true }),
    ).resolves.toEqual({ forced: false });
  });

  it("is not required by a destructive call with no body to lose", async () => {
    await expect(
      forced(request({ destructive: true, body: undefined }), { nonInteractive: true }),
    ).resolves.toEqual({ forced: false });
  });
});
