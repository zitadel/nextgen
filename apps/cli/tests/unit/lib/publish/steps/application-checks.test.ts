import { describe, expect, it } from "vitest";

import { ForbiddenError } from "@/lib/backend/errors";
import { ZitadelError } from "@/lib/errors";
import { validateApplications } from "@/lib/publish/steps/application-checks";
import { aConfig, anApplication, aUserSchema } from "@tests/helpers/config";
import type { ClientStubs } from "@tests/helpers/fake-client";
import { holdingVariables, SECRET_VARIABLE } from "@tests/helpers/records";
import { aStepContext } from "@tests/helpers/step-context";
import { rejectionOf } from "@tests/helpers/thrown-value";

/**
 * A configuration holding one application, whose client names
 * `SHOP_WEB_CLIENT_SECRET`.
 */
const SHOP = aConfig({ applications: { "shop.json": anApplication() } });

/**
 * The project's variables, which this run's token may not read.
 */
const FORBIDDEN: ClientStubs = {
  listVariables: async () => {
    throw new ForbiddenError("Forbidden", { status: 403, url: "https://api.example/variables" });
  },
};

describe("validateApplications", () => {
  it("accepts a client whose secret is a secret variable the project holds", async () => {
    const context = aStepContext({
      config: SHOP,
      client: holdingVariables({ SHOP_WEB_CLIENT_SECRET: SECRET_VARIABLE }),
    });

    const error = await rejectionOf(() => {
      return validateApplications(context);
    });

    expect(error).toBeUndefined();
  });

  it("reads no variables without an application", async () => {
    const config = aConfig({ schemas: { "human-user.json": aUserSchema() } });
    const context = aStepContext({ config, client: FORBIDDEN });

    const error = await rejectionOf(() => {
      return validateApplications(context);
    });

    expect(error).toBeUndefined();
  });

  it("refuses a secret variable the project lacks, naming the file and client", async () => {
    const context = aStepContext({ config: SHOP, client: holdingVariables({}) });

    const error = await rejectionOf(() => {
      return validateApplications(context);
    });

    expect(error).toBeInstanceOf(ZitadelError);
    expect(error).toMatchObject({
      code: "E_CREDENTIAL_MISSING",
      message:
        '.zitadel/applications/shop.json: client "web" names the variable SHOP_WEB_CLIENT_SECRET as its secret, which the project does not have',
      nextCommands: [
        {
          id: "variable:set",
          args: { name: "SHOP_WEB_CLIENT_SECRET" },
          flags: { secret: true, preview: false },
        },
      ],
    });
  });

  it("refuses a secret held in a plain variable", async () => {
    const context = aStepContext({
      config: SHOP,
      client: holdingVariables({ SHOP_WEB_CLIENT_SECRET: "plain" }),
    });

    const error = await rejectionOf(() => {
      return validateApplications(context);
    });

    expect(error).toBeInstanceOf(ZitadelError);
    expect(error).toMatchObject({
      code: "E_VALIDATION",
      message: expect.stringContaining("which is not a secret"),
    });
  });

  it("refuses a deploy whose token may not read the variables", async () => {
    const context = aStepContext({ config: SHOP, client: FORBIDDEN });

    const error = await rejectionOf(() => {
      return validateApplications(context);
    });

    expect(error).toBeInstanceOf(ForbiddenError);
  });

  describe("with a preview", () => {
    it("checks the preview kind's variables", async () => {
      const context = aStepContext({
        config: SHOP,
        mode: "preview",
        client: holdingVariables({ SHOP_WEB_CLIENT_SECRET: SECRET_VARIABLE }, "preview"),
      });

      const error = await rejectionOf(() => {
        return validateApplications(context);
      });

      expect(error).toBeUndefined();
    });

    it("leaves the check to the deploy when its token may not read the variables", async () => {
      const context = aStepContext({ config: SHOP, mode: "preview", client: FORBIDDEN });

      const error = await rejectionOf(() => {
        return validateApplications(context);
      });

      expect(error).toBeUndefined();
    });
  });
});
