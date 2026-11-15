import { describe, expect, it } from "vitest";

import { ForbiddenError } from "@/lib/backend/errors";
import { ZitadelError } from "@/lib/errors";
import { validateConnections } from "@/lib/publish/steps/idp-checks";
import { aConfig, anOidcConnection } from "@tests/helpers/config";
import type { ClientStubs } from "@tests/helpers/fake-client";
import { holdingVariables, SECRET_VARIABLE } from "@tests/helpers/records";
import { aStepContext } from "@tests/helpers/step-context";
import { rejectionOf } from "@tests/helpers/thrown-value";

/**
 * A configuration holding one connection, the default `acme` one.
 */
const ACME = aConfig({ connections: { "acme.json": anOidcConnection() } });

/**
 * The project's variables, which this run's token may not read.
 */
const FORBIDDEN: ClientStubs = {
  listVariables: async () => {
    throw new ForbiddenError("Forbidden", { status: 403, url: "https://api.example/variables" });
  },
};

describe("validateConnections", () => {
  it("accepts a client_secret that references a secret variable", async () => {
    const context = aStepContext({
      config: ACME,
      client: holdingVariables({ ACME_CLIENT_SECRET: SECRET_VARIABLE }),
    });

    const error = await rejectionOf(() => {
      return validateConnections(context);
    });

    expect(error).toBeUndefined();
  });

  it("accepts a connection with no oidc block", async () => {
    const config = aConfig({ connections: { "saml.json": { slug: "saml", protocol: "saml" } } });
    const context = aStepContext({ config, client: holdingVariables({}) });

    const error = await rejectionOf(() => {
      return validateConnections(context);
    });

    expect(error).toBeUndefined();
  });

  it("names the connection file in a refusal", async () => {
    const config = aConfig({ connections: { "acme-workspace.json": anOidcConnection() } });
    const context = aStepContext({ config, client: holdingVariables({}) });

    const error = await rejectionOf(() => {
      return validateConnections(context);
    });

    expect(error).toBeInstanceOf(ZitadelError);
    expect(error).toMatchObject({
      message: expect.stringContaining(".zitadel/idps/acme-workspace.json"),
    });
  });

  it("names the file of a later connection by its place in the configuration", async () => {
    const okta = anOidcConnection({
      slug: "okta",
      oidc: { client_secret: "${{ OKTA_CLIENT_SECRET }}" },
    });
    const config = aConfig({
      connections: { "b-okta.json": okta, "a-acme.json": anOidcConnection() },
    });
    const context = aStepContext({
      config,
      client: holdingVariables({ ACME_CLIENT_SECRET: SECRET_VARIABLE }),
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
    it("refuses a client_secret naming a variable the project lacks", async () => {
      const context = aStepContext({ config: ACME, client: holdingVariables({}) });

      const error = await rejectionOf(() => {
        return validateConnections(context);
      });

      expect(error).toBeInstanceOf(ZitadelError);
      expect(error).toMatchObject({ code: "E_CREDENTIAL_MISSING" });
    });

    it("suggests publishing a missing variable in the environment the deploy addressed", async () => {
      const context = aStepContext({ config: ACME, client: holdingVariables({}) });

      const error = await rejectionOf(() => {
        return validateConnections(context);
      });

      expect(error).toBeInstanceOf(ZitadelError);
      expect(error).toMatchObject({
        nextCommands: [
          expect.stringMatching(/ variable set ACME_CLIENT_SECRET --secret --env staging$/),
        ],
      });
    });

    it("refuses a client_secret held in a plain variable", async () => {
      const context = aStepContext({
        config: ACME,
        client: holdingVariables({ ACME_CLIENT_SECRET: "plain" }),
      });

      const error = await rejectionOf(() => {
        return validateConnections(context);
      });

      expect(error).toBeInstanceOf(ZitadelError);
      expect(error).toMatchObject({ message: expect.stringContaining("which is not a secret") });
    });

    it("refuses a client_id held in a secret variable", async () => {
      const config = aConfig({
        connections: {
          "acme.json": anOidcConnection({ oidc: { client_id: "${{ ACME_CLIENT_ID }}" } }),
        },
      });
      const context = aStepContext({
        config,
        client: holdingVariables({
          ACME_CLIENT_ID: SECRET_VARIABLE,
          ACME_CLIENT_SECRET: SECRET_VARIABLE,
        }),
      });

      const error = await rejectionOf(() => {
        return validateConnections(context);
      });

      expect(error).toBeInstanceOf(ZitadelError);
      expect(error).toMatchObject({ message: expect.stringContaining("which is a secret") });
    });

    it("refuses a client_id and client_secret that name the same variable", async () => {
      const config = aConfig({
        connections: {
          "acme.json": anOidcConnection({ oidc: { client_id: "${{ ACME_CLIENT_SECRET }}" } }),
        },
      });
      const context = aStepContext({
        config,
        client: holdingVariables({ ACME_CLIENT_SECRET: SECRET_VARIABLE }),
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

    it("fails when its token may not read the variables", async () => {
      const context = aStepContext({ config: ACME, client: FORBIDDEN });

      const error = await rejectionOf(() => {
        return validateConnections(context);
      });

      expect(error).toBeInstanceOf(ForbiddenError);
    });
  });

  describe("with a preview", () => {
    it("refuses a connection naming a variable the project lacks", async () => {
      const context = aStepContext({ config: ACME, mode: "preview", client: holdingVariables({}) });

      const error = await rejectionOf(() => {
        return validateConnections(context);
      });

      expect(error).toBeInstanceOf(ZitadelError);
      expect(error).toMatchObject({ code: "E_CREDENTIAL_MISSING" });
    });

    it("suggests setting the missing credential for the preview kind", async () => {
      const context = aStepContext({ config: ACME, mode: "preview", client: holdingVariables({}) });

      const error = await rejectionOf(() => {
        return validateConnections(context);
      });

      expect(error).toBeInstanceOf(ZitadelError);
      expect(error).toMatchObject({
        nextCommands: [
          expect.stringMatching(
            / variable set ACME_CLIENT_SECRET --secret --preview --env staging$/,
          ),
        ],
      });
    });

    it("does not count a credential only the primary kind holds", async () => {
      const context = aStepContext({
        config: ACME,
        mode: "preview",
        client: holdingVariables({ ACME_CLIENT_SECRET: SECRET_VARIABLE }, "primary"),
      });

      const error = await rejectionOf(() => {
        return validateConnections(context);
      });

      expect(error).toBeInstanceOf(ZitadelError);
      expect(error).toMatchObject({ code: "E_CREDENTIAL_MISSING" });
    });

    it("counts a credential the preview kind holds", async () => {
      const context = aStepContext({
        config: ACME,
        mode: "preview",
        client: holdingVariables({ ACME_CLIENT_SECRET: SECRET_VARIABLE }, "preview"),
      });

      const error = await rejectionOf(() => {
        return validateConnections(context);
      });

      expect(error).toBeUndefined();
    });

    it("leaves the variable check to the deploy when its token may not read them", async () => {
      const context = aStepContext({ config: ACME, mode: "preview", client: FORBIDDEN });

      const error = await rejectionOf(() => {
        return validateConnections(context);
      });

      expect(error).toBeUndefined();
    });
  });
});
