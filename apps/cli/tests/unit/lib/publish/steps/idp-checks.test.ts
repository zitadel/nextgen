import type { SetupServer } from "msw/node";
import { describe, expect } from "vitest";

import { it } from "@tests/fixtures";

import { ForbiddenError } from "@/lib/backend/errors";
import { ZitadelError } from "@/lib/errors";
import { validateConnections } from "@/lib/publish/steps/idp-checks";
import { aConfig, anOidcConnection } from "@tests/helpers/config";
import { answering, refusal, answeringVariables } from "@tests/helpers/api-answers";
import { SECRET_VARIABLE } from "@tests/helpers/records";
import { aStepContext } from "@tests/helpers/step-context";
import { rejectionOf } from "@tests/helpers/thrown-value";

/**
 * A configuration holding one connection, the default `acme` one.
 */
const ACME = aConfig({ connections: { "acme.json": anOidcConnection() } });

/**
 * The project's variables, which this run's token may not read.
 *
 * @param server - The test's MSW server.
 */
function forbiddingVariables(server: SetupServer): void {
  answering(server, "listVariables", refusal(403, "var.permission_denied"));
}

describe("validateConnections", () => {
  it("accepts a client_secret that references a secret variable", async ({ server }) => {
    answeringVariables(server, { ACME_CLIENT_SECRET: SECRET_VARIABLE });
    const context = aStepContext({
      config: ACME,
    });

    const error = await rejectionOf(() => {
      return validateConnections(context);
    });

    expect(error).toBeUndefined();
  });

  it("accepts a connection with no oidc block", async ({ server }) => {
    answeringVariables(server, {});
    const config = aConfig({ connections: { "saml.json": { slug: "saml", protocol: "saml" } } });
    const context = aStepContext({ config });

    const error = await rejectionOf(() => {
      return validateConnections(context);
    });

    expect(error).toBeUndefined();
  });

  it("names the connection file in a refusal", async ({ server }) => {
    answeringVariables(server, {});
    const config = aConfig({ connections: { "acme-workspace.json": anOidcConnection() } });
    const context = aStepContext({ config });

    const error = await rejectionOf(() => {
      return validateConnections(context);
    });

    expect(error).toBeInstanceOf(ZitadelError);
    expect(error).toMatchObject({
      message: expect.stringContaining(".zitadel/idps/acme-workspace.json"),
    });
  });

  it("names the file of a later connection by its place in the configuration", async ({
    server,
  }) => {
    answeringVariables(server, { ACME_CLIENT_SECRET: SECRET_VARIABLE });
    const okta = anOidcConnection({
      slug: "okta",
      oidc: { client_secret: "${{ OKTA_CLIENT_SECRET }}" },
    });
    const config = aConfig({
      connections: { "b-okta.json": okta, "a-acme.json": anOidcConnection() },
    });
    const context = aStepContext({
      config,
    });

    const error = await rejectionOf(() => {
      return validateConnections(context);
    });

    expect(error).toBeInstanceOf(ZitadelError);
    expect(error).toMatchObject({
      message: expect.stringContaining(
        ".zitadel/idps/b-okta.json: client_secret names the variable OKTA_CLIENT_SECRET",
      ),
    });
  });

  describe("with a deploy", () => {
    it("refuses a client_secret naming a variable the project lacks", async ({ server }) => {
      answeringVariables(server, {});
      const context = aStepContext({ config: ACME });

      const error = await rejectionOf(() => {
        return validateConnections(context);
      });

      expect(error).toBeInstanceOf(ZitadelError);
      expect(error).toMatchObject({ code: "E_CREDENTIAL_MISSING" });
    });

    it("suggests publishing a missing variable", async ({ server }) => {
      answeringVariables(server, {});
      const context = aStepContext({ config: ACME });

      const error = await rejectionOf(() => {
        return validateConnections(context);
      });

      expect(error).toBeInstanceOf(ZitadelError);
      expect(error).toMatchObject({
        nextCommands: [
          {
            id: "variable:set",
            args: { name: "ACME_CLIENT_SECRET" },
            flags: { secret: true, preview: false },
          },
        ],
      });
    });

    it("refuses a client_secret held in a plain variable", async ({ server }) => {
      answeringVariables(server, { ACME_CLIENT_SECRET: "plain" });
      const context = aStepContext({
        config: ACME,
      });

      const error = await rejectionOf(() => {
        return validateConnections(context);
      });

      expect(error).toBeInstanceOf(ZitadelError);
      expect(error).toMatchObject({ message: expect.stringContaining("which is not a secret") });
    });

    it("refuses a client_id held in a secret variable", async ({ server }) => {
      answeringVariables(server, {
        ACME_CLIENT_ID: SECRET_VARIABLE,
        ACME_CLIENT_SECRET: SECRET_VARIABLE,
      });
      const config = aConfig({
        connections: {
          "acme.json": anOidcConnection({ oidc: { client_id: "${{ ACME_CLIENT_ID }}" } }),
        },
      });
      const context = aStepContext({
        config,
      });

      const error = await rejectionOf(() => {
        return validateConnections(context);
      });

      expect(error).toBeInstanceOf(ZitadelError);
      expect(error).toMatchObject({ message: expect.stringContaining("which is a secret") });
    });

    it("refuses a client_id and client_secret that name the same variable", async ({ server }) => {
      answeringVariables(server, { ACME_CLIENT_SECRET: SECRET_VARIABLE });
      const config = aConfig({
        connections: {
          "acme.json": anOidcConnection({ oidc: { client_id: "${{ ACME_CLIENT_SECRET }}" } }),
        },
      });
      const context = aStepContext({
        config,
      });

      const error = await rejectionOf(() => {
        return validateConnections(context);
      });

      expect(error).toBeInstanceOf(ZitadelError);
      expect(error).toMatchObject({
        message: expect.stringContaining(
          "client_id and client_secret both name the variable ACME_CLIENT_SECRET",
        ),
      });
    });

    it("fails when its token may not read the variables", async ({ server }) => {
      forbiddingVariables(server);
      const context = aStepContext({ config: ACME });

      const error = await rejectionOf(() => {
        return validateConnections(context);
      });

      expect(error).toBeInstanceOf(ForbiddenError);
    });
  });

  describe("with a preview", () => {
    it("refuses a connection naming a variable the project lacks", async ({ server }) => {
      answeringVariables(server, {});
      const context = aStepContext({ config: ACME, mode: "preview" });

      const error = await rejectionOf(() => {
        return validateConnections(context);
      });

      expect(error).toBeInstanceOf(ZitadelError);
      expect(error).toMatchObject({ code: "E_CREDENTIAL_MISSING" });
    });

    it("suggests setting the missing credential for the preview kind", async ({ server }) => {
      answeringVariables(server, {});
      const context = aStepContext({ config: ACME, mode: "preview" });

      const error = await rejectionOf(() => {
        return validateConnections(context);
      });

      expect(error).toBeInstanceOf(ZitadelError);
      expect(error).toMatchObject({
        nextCommands: [
          {
            id: "variable:set",
            args: { name: "ACME_CLIENT_SECRET" },
            flags: { secret: true, preview: true },
          },
        ],
      });
    });

    it("does not count a credential only the primary kind holds", async ({ server }) => {
      answeringVariables(server, { ACME_CLIENT_SECRET: SECRET_VARIABLE }, "primary");
      const context = aStepContext({
        config: ACME,
        mode: "preview",
      });

      const error = await rejectionOf(() => {
        return validateConnections(context);
      });

      expect(error).toBeInstanceOf(ZitadelError);
      expect(error).toMatchObject({ code: "E_CREDENTIAL_MISSING" });
    });

    it("counts a credential the preview kind holds", async ({ server }) => {
      answeringVariables(server, { ACME_CLIENT_SECRET: SECRET_VARIABLE }, "preview");
      const context = aStepContext({
        config: ACME,
        mode: "preview",
      });

      const error = await rejectionOf(() => {
        return validateConnections(context);
      });

      expect(error).toBeUndefined();
    });

    it("leaves the variable check to the deploy when its token may not read them", async ({
      server,
    }) => {
      forbiddingVariables(server);
      const context = aStepContext({ config: ACME, mode: "preview" });

      const error = await rejectionOf(() => {
        return validateConnections(context);
      });

      expect(error).toBeUndefined();
    });
  });
});
