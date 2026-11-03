import { describe, expect, it } from "vitest";

import { ssoProvider } from "../../../../../../../src/commands/auth-method/sso/enable/requirements/provider";
import { requirementContext } from "../../../../../../helpers/requirement-context";

describe("ssoProvider", () => {
  it("is a catalog provider by its name", async () => {
    const found = await ssoProvider.resolve(requirementContext({ flags: { provider: "google" } }));

    expect(found).toMatchObject({
      selection: {
        kind: "catalog",
      },
    });
  });

  it("refuses an unknown provider", async () => {
    await expect(
      ssoProvider.resolve(requirementContext({ flags: { provider: "nope" } })),
    ).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: "Unknown provider nope",
    });
  });

  it("refuses a custom setting beside a catalog provider", async () => {
    await expect(
      ssoProvider.resolve(requirementContext({ flags: { provider: "google", slug: "acme" } })),
    ).rejects.toMatchObject({
      code: "E_VALIDATION",
    });
  });

  it("holds a script to the flags and names the ones a custom connection lacks", async () => {
    await expect(
      ssoProvider.resolve(
        requirementContext({
          flags: { provider: "custom", slug: "acme" },
          meta: { nonInteractive: true },
        }),
      ),
    ).rejects.toMatchObject({
      code: "E_VALIDATION",
      details: {
        missing: ["--display-name", "--issuer"],
      },
    });
  });

  it("leaves a person at a terminal to be asked for the settings they left out", async () => {
    const found = await ssoProvider.resolve(
      requirementContext({
        flags: { provider: "custom", slug: "acme" },
        meta: { nonInteractive: false },
      }),
    );

    expect(found).toMatchObject({
      selection: undefined,
      values: {
        slug: "acme",
      },
    });
  });

  it("checks the settings a person did give before asking for the rest", async () => {
    await expect(
      ssoProvider.resolve(
        requirementContext({
          flags: { provider: "custom", issuer: "not a url" },
          meta: { nonInteractive: false },
        }),
      ),
    ).rejects.toMatchObject({
      code: "E_VALIDATION",
    });
  });

  it("holds a dry run to the flags as a script is", async () => {
    await expect(
      ssoProvider.resolve(
        requirementContext({
          flags: { provider: "custom", slug: "acme" },
          meta: { nonInteractive: false, dryRun: true },
        }),
      ),
    ).rejects.toMatchObject({
      code: "E_VALIDATION",
    });
  });
});
