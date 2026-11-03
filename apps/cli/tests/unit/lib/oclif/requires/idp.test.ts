import { describe, expect, it } from "vitest";

import type { GlobalOptions } from "../../../../../src/lib/oclif";
import { providerToRemove, ssoFlows, ssoProvider } from "../../../../../src/lib/oclif/requires/idp";
import { schemaTarget } from "../../../../../src/lib/oclif/requires/schema";
import { defaultSchema, makeProject, setUpProject } from "../../../../helpers/local-project";

function meta(overrides: Partial<GlobalOptions> = {}): GlobalOptions {
  return {
    cwd: "/project",
    nonInteractive: true,
    dryRun: false,
    ...overrides,
  } as GlobalOptions;
}

function contextFor(
  flags: Record<string, unknown>,
  options: { meta?: GlobalOptions; resolved?: Record<string, unknown> } = {},
) {
  return {
    flags,
    args: {},
    meta: options.meta ?? meta(),
    resolved: options.resolved ?? {},
  };
}

async function targetOf(cwd: string) {
  return schemaTarget.resolve(contextFor({}, { meta: meta({ cwd }) }));
}

describe("ssoProvider", () => {
  it("is a catalog provider by its name", async () => {
    const found = await ssoProvider.resolve(contextFor({ provider: "google" }));

    expect(found?.selection).toMatchObject({
      kind: "catalog",
    });
  });

  it("refuses an unknown provider", async () => {
    await expect(ssoProvider.resolve(contextFor({ provider: "nope" }))).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: "Unknown provider nope",
    });
  });

  it("refuses a custom setting beside a catalog provider", async () => {
    await expect(
      ssoProvider.resolve(contextFor({ provider: "google", slug: "acme" })),
    ).rejects.toMatchObject({
      code: "E_VALIDATION",
    });
  });

  it("holds a script to the flags and names the ones a custom connection lacks", async () => {
    await expect(
      ssoProvider.resolve(contextFor({ provider: "custom", slug: "acme" })),
    ).rejects.toMatchObject({
      code: "E_VALIDATION",
      details: {
        missing: ["--display-name", "--issuer"],
      },
    });
  });

  it("leaves a person at a terminal to be asked for the settings they left out", async () => {
    const found = await ssoProvider.resolve(
      contextFor({ provider: "custom", slug: "acme" }, { meta: meta({ nonInteractive: false }) }),
    );

    expect(found?.selection).toBeUndefined();
    expect(found?.values.slug).toBe("acme");
  });

  it("checks the settings a person did give before asking for the rest", async () => {
    await expect(
      ssoProvider.resolve(
        contextFor(
          { provider: "custom", issuer: "not a url" },
          { meta: meta({ nonInteractive: false }) },
        ),
      ),
    ).rejects.toMatchObject({
      code: "E_VALIDATION",
    });
  });

  it("holds a dry run to the flags as a script is", async () => {
    await expect(
      ssoProvider.resolve(
        contextFor(
          { provider: "custom", slug: "acme" },
          { meta: meta({ nonInteractive: false, dryRun: true }) },
        ),
      ),
    ).rejects.toMatchObject({
      code: "E_VALIDATION",
    });
  });
});

describe("ssoFlows", () => {
  it("is the flows that run against the schema", async () => {
    const target = await targetOf(await setUpProject());

    const flows = await ssoFlows.resolve(contextFor({}, { resolved: { target } }));

    expect(flows).toHaveLength(1);
  });

  it("refuses a schema no login flow runs against", async () => {
    const target = await targetOf(
      await makeProject({
        schemas: {
          customers: defaultSchema,
        },
      }),
    );

    await expect(ssoFlows.resolve(contextFor({}, { resolved: { target } }))).rejects.toMatchObject({
      code: "E_NOT_FOUND",
      message: "No login flow runs against customers",
    });
  });
});

describe("providerToRemove", () => {
  it("is the provider that was named", async () => {
    expect(await providerToRemove.resolve(contextFor({ provider: "github" }))).toBe("github");
  });

  it("refuses when none is named, listing what the schema offers", async () => {
    const target = await targetOf(
      await setUpProject({
        customers: {
          ...defaultSchema,
          "x-auth-methods": {
            sso: {
              enabled: true,
              providers: ["github"],
            },
          },
        },
      }),
    );

    await expect(
      providerToRemove.resolve(contextFor({}, { resolved: { target } })),
    ).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: "Name the provider to remove",
      hint: expect.stringContaining("customers offers: github."),
    });
  });

  it("says when the schema offers none", async () => {
    const target = await targetOf(await setUpProject());

    await expect(
      providerToRemove.resolve(contextFor({}, { resolved: { target } })),
    ).rejects.toMatchObject({
      hint: expect.stringContaining("default-human-user offers: none."),
    });
  });
});
