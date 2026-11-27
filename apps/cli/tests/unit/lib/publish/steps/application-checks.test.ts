import { describe, expect } from "vitest";

import { BackendForbiddenError } from "@/lib/backend";
import {
  PublishApplicationSecretMissingError,
  PublishApplicationSecretPlainError,
} from "@/lib/publish";
import { validateApplications } from "@/lib/publish/steps/application-checks";
import { it } from "@tests/fixtures";
import { answering, answeringVariables, refusal } from "@tests/helpers/api-answers";
import { aConfig, anApplication, aUserSchema } from "@tests/helpers/config";
import { SECRET_VARIABLE } from "@tests/helpers/records";
import { aStepContext } from "@tests/helpers/step-context";
import { rejectionOf } from "@tests/helpers/thrown-value";

/**
 * A configuration holding one application, whose client names
 * `SHOP_WEB_CLIENT_SECRET`.
 */
const SHOP = aConfig({ applications: { "shop.json": anApplication() } });

describe("validateApplications", () => {
  it("accepts a client whose secret is a secret variable the project holds", async ({ server }) => {
    answeringVariables(server, { SHOP_WEB_CLIENT_SECRET: SECRET_VARIABLE });
    const context = aStepContext({
      config: SHOP,
    });

    const error = await rejectionOf(() => {
      return validateApplications(context);
    });

    expect(error).toBeUndefined();
  });

  it("reads no variables without an application", async ({ server }) => {
    answering(server, "listVariables", refusal(403, "var.permission_denied"));
    const config = aConfig({ schemas: { "human-user.json": aUserSchema() } });
    const context = aStepContext({ config });

    const error = await rejectionOf(() => {
      return validateApplications(context);
    });

    expect(error).toBeUndefined();
  });

  it("refuses a secret variable the project lacks, naming the file and client", async ({
    server,
  }) => {
    answeringVariables(server, {});
    const context = aStepContext({ config: SHOP });

    const error = await rejectionOf(() => {
      return validateApplications(context);
    });

    expect(error).toBeInstanceOf(PublishApplicationSecretMissingError);
    expect(error).toMatchObject({
      message:
        '.zitadel/applications/shop.json: client "web" names the variable SHOP_WEB_CLIENT_SECRET as its secret, which the project does not have',
      use: {
        variable: "SHOP_WEB_CLIENT_SECRET",
        client: "web",
        file: ".zitadel/applications/shop.json",
        preview: false,
      },
    });
  });

  it("refuses a secret held in a plain variable", async ({ server }) => {
    answeringVariables(server, { SHOP_WEB_CLIENT_SECRET: "plain" });
    const context = aStepContext({
      config: SHOP,
    });

    const error = await rejectionOf(() => {
      return validateApplications(context);
    });

    expect(error).toBeInstanceOf(PublishApplicationSecretPlainError);
    expect(error).toMatchObject({
      message: expect.stringContaining("which is not a secret"),
    });
  });

  it("refuses a deploy whose token may not read the variables", async ({ server }) => {
    answering(server, "listVariables", refusal(403, "var.permission_denied"));
    const context = aStepContext({ config: SHOP });

    const error = await rejectionOf(() => {
      return validateApplications(context);
    });

    expect(error).toBeInstanceOf(BackendForbiddenError);
  });

  describe("with a preview", () => {
    it("checks the preview kind's variables", async ({ server }) => {
      answeringVariables(server, { SHOP_WEB_CLIENT_SECRET: SECRET_VARIABLE }, "preview");
      const context = aStepContext({
        config: SHOP,
        mode: "preview",
      });

      const error = await rejectionOf(() => {
        return validateApplications(context);
      });

      expect(error).toBeUndefined();
    });

    it("leaves the check to the deploy when its token may not read the variables", async ({
      server,
    }) => {
      answering(server, "listVariables", refusal(403, "var.permission_denied"));
      const context = aStepContext({ config: SHOP, mode: "preview" });

      const error = await rejectionOf(() => {
        return validateApplications(context);
      });

      expect(error).toBeUndefined();
    });
  });
});
