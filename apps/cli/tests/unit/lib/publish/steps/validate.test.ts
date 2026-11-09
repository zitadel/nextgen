import { describe, expect, it, vi } from "vitest";

import { SchemaService } from "@/lib/backend";
import { ZitadelError } from "@/lib/errors";
import { validateStep } from "@/lib/publish/steps/validate";
import {
  aBranding,
  aConfig,
  aLoginFlow,
  anOidcConnection,
  aPasswordPolicy,
  aStore,
  aUserSchema,
  PASSWORD_POLICY,
} from "@tests/helpers/config";
import { fakeClient, pagesOf } from "@tests/helpers/fake-client";
import { holdingVariables, PROJECT_ID, SECRET_VARIABLE } from "@tests/helpers/records";
import { aStepContext } from "@tests/helpers/step-context";
import { rejectionOf } from "@tests/helpers/thrown-value";

/**
 * What the step reports for a configuration it accepts.
 */
const ACCEPTED = { warnings: [] };

/**
 * A connection whose client secret is written out rather than referenced.
 */
const LITERAL_SECRET = anOidcConnection({ oidc: { client_secret: "a-literal-secret" } });

/**
 * The project's variables, holding the secret the default connection names.
 */
const ACME_SECRET_HELD = holdingVariables({ ACME_CLIENT_SECRET: SECRET_VARIABLE });

/**
 * The project's variables, holding none.
 */
const NOTHING_HELD = holdingVariables({});

/**
 * A configuration of the shipped user schema and a login flow whose identifier
 * step collects `collects` for the schema `userSchema`.
 *
 * @param userSchema - What the flow names as its user schema.
 * @param collects - The fields the identifier step collects.
 * @returns The configuration.
 */
function aFlowNaming(userSchema: string, collects: readonly string[]) {
  return aConfig({
    schemas: { "human-user.json": aUserSchema() },
    flows: { "default-login.json": aLoginFlow({ userSchema, collects }) },
  });
}

/**
 * A schema service over a project holding the latest revision of each of
 * `objectTypes`, and the stub its listing goes through.
 *
 * @param objectTypes - The object types the project holds.
 * @returns The service, and the listing to observe.
 */
function aProjectHolding(...objectTypes: string[]) {
  const listSchemas = vi.fn(({ object_type }: { object_type?: string }) => {
    return pagesOf({
      schemas: objectTypes.includes(object_type ?? "") ? [{ id: "sch_1" }] : [],
      next_page_token: null,
    });
  });
  const schemas = new SchemaService(
    fakeClient({ listSchemas: { pages: listSchemas } }),
    PROJECT_ID,
  );
  return { schemas, listSchemas };
}

describe("validateStep", () => {
  it("passes when every referenced variable resolves and every kind is valid", async () => {
    const config = aConfig({
      schemas: { "human-user.json": aUserSchema({ $comment: "${PRESENT_VAR}" }) },
      branding: { "branding.json": aBranding() },
    });

    const result = await validateStep.run(aStepContext({ config, env: { PRESENT_VAR: "v1" } }));

    expect(result).toEqual(ACCEPTED);
  });

  it("refuses a resource naming an environment variable the env lacks", async () => {
    const config = aConfig({
      schemas: { "human-user.json": aUserSchema({ $comment: "${MISSING_VAR}" }) },
    });

    const error = await rejectionOf(() => {
      return validateStep.run(aStepContext({ config }));
    });

    expect(error).toBeInstanceOf(ZitadelError);
    expect(error).toMatchObject({
      code: "E_VALIDATION",
      message: expect.stringContaining("MISSING_VAR"),
    });
  });

  it("names every refused file in one refusal", async () => {
    const config = aConfig({
      schemas: { "a.json": { objectType: "a" }, "b.json": { objectType: "b" } },
    });

    const error = await rejectionOf(() => {
      return validateStep.run(aStepContext({ config }));
    });

    expect(error).toBeInstanceOf(ZitadelError);
    expect(error).toMatchObject({
      message: expect.stringMatching(
        /\.zitadel\/schemas\/a\.json[\s\S]*\.zitadel\/schemas\/b\.json/,
      ),
    });
  });

  describe("with a schema file", () => {
    it("refuses one that is not a user schema", async () => {
      const config = aConfig({ schemas: { "human-user.json": { objectType: "human-user" } } });

      const error = await rejectionOf(() => {
        return validateStep.run(aStepContext({ config }));
      });

      expect(error).toBeInstanceOf(ZitadelError);
      expect(error).toMatchObject({ code: "E_VALIDATION" });
    });

    it("refuses an x-auth-methods key that is no authentication method, naming the file", async () => {
      const schema = aUserSchema({
        "x-auth-methods": { password: { enabled: true }, pasword: { enabled: true } },
      });
      const config = aConfig({ schemas: { "human-user.json": schema } });

      const error = await rejectionOf(() => {
        return validateStep.run(aStepContext({ config }));
      });

      expect(error).toBeInstanceOf(ZitadelError);
      expect(error).toMatchObject({
        details: {
          issues: [
            expect.objectContaining({
              path: ".zitadel/schemas/human-user.json",
              message: expect.stringMatching(/x-auth-methods pasword is not/),
            }),
          ],
        },
      });
    });
  });

  describe("with a connection file", () => {
    it("refuses a literal client_secret, naming the file", async () => {
      const config = aConfig({ connections: { "acme.json": LITERAL_SECRET } });

      const error = await rejectionOf(() => {
        return validateStep.run(aStepContext({ config }));
      });

      expect(error).toBeInstanceOf(ZitadelError);
      expect(error).toMatchObject({
        code: "E_VALIDATION",
        message: expect.stringContaining(
          ".zitadel/idps/acme.json: client_secret must reference a variable, not hold a value",
        ),
      });
    });

    it("tells a literal client_secret how to publish it, in the deploy's environment", async () => {
      const config = aConfig({ connections: { "acme.json": LITERAL_SECRET } });

      const error = await rejectionOf(() => {
        return validateStep.run(aStepContext({ config }));
      });

      expect(error).toBeInstanceOf(ZitadelError);
      expect(error).toMatchObject({
        hint: expect.stringContaining("variable set NAME --secret --env staging"),
      });
    });

    it("words the hint of a refusal without claiming the server enforces every rule", async () => {
      const config = aConfig({ flows: { "login.json": { name: "bad" } } });

      const error = await rejectionOf(() => {
        return validateStep.run(aStepContext({ config }));
      });

      expect(error).toMatchObject({
        hint: "Fix the files named above and re-run; no changes were made.",
      });
    });

    it("leaves out the subject-claim advice when the connections could not be listed", async () => {
      const config = aConfig({
        connections: { "acme.json": anOidcConnection({ subject_claim: "email" }) },
      });

      const unlisted = await validateStep.run(
        aStepContext({ config, client: ACME_SECRET_HELD, deployedUnknown: true }),
      );
      const listed = await validateStep.run(aStepContext({ config, client: ACME_SECRET_HELD }));

      expect(unlisted).toEqual(ACCEPTED);
      expect(listed?.warnings).toContainEqual(expect.stringContaining("subject_claim is"));
    });

    it.each([
      ["on a dry run", { dryRun: true }],
      ["for a preview", { mode: "preview" }],
    ] as const)("refuses a literal client_secret %s too", async (_run, overrides) => {
      const config = aConfig({ connections: { "acme.json": LITERAL_SECRET } });

      const error = await rejectionOf(() => {
        return validateStep.run(aStepContext({ config, ...overrides }));
      });

      expect(error).toBeInstanceOf(ZitadelError);
      expect(error).toMatchObject({ code: "E_VALIDATION" });
    });

    it("refuses a literal client_secret in a later one after an earlier one passes", async () => {
      const config = aConfig({
        connections: { "a-acme.json": anOidcConnection(), "b-acme.json": LITERAL_SECRET },
      });

      const error = await rejectionOf(() => {
        return validateStep.run(aStepContext({ config, client: ACME_SECRET_HELD }));
      });

      expect(error).toBeInstanceOf(ZitadelError);
      expect(error).toMatchObject({
        code: "E_VALIDATION",
        message: expect.stringContaining(".zitadel/idps/b-acme.json: client_secret must reference"),
      });
    });

    it("refuses a literal client_secret before the project's variables are read", async () => {
      const getVariables = vi.fn(async () => {
        return {};
      });
      const config = aConfig({ connections: { "acme.json": LITERAL_SECRET } });

      await rejectionOf(() => {
        return validateStep.run(aStepContext({ config, client: { getVariables } }));
      });

      expect(getVariables).not.toHaveBeenCalled();
    });

    it("never echoes a literal client_secret in the refusal", async () => {
      const config = aConfig({ connections: { "acme.json": LITERAL_SECRET } });

      const error = await rejectionOf(() => {
        return validateStep.run(aStepContext({ config }));
      });

      expect(error).toBeInstanceOf(ZitadelError);
      expect(JSON.stringify(error)).not.toContain("a-literal-secret");
    });

    it("refuses an oidc block naming some endpoints but not the rest", async () => {
      const partial = anOidcConnection({
        oidc: { authorization_endpoint: "https://sso.acme.example/auth" },
      });
      const config = aConfig({ connections: { "acme.json": partial } });

      const error = await rejectionOf(() => {
        return validateStep.run(aStepContext({ config }));
      });

      expect(error).toBeInstanceOf(ZitadelError);
      expect(error).toMatchObject({
        message: expect.stringContaining(
          ".zitadel/idps/acme.json: oidc names some endpoints but not jwks_uri, token_endpoint, userinfo_endpoint",
        ),
      });
    });

    it("passes an oidc block naming every endpoint", async () => {
      const complete = anOidcConnection({
        oidc: {
          authorization_endpoint: "https://sso.acme.example/auth",
          jwks_uri: "https://sso.acme.example/jwks",
          token_endpoint: "https://sso.acme.example/token",
          userinfo_endpoint: "https://sso.acme.example/userinfo",
        },
      });
      const config = aConfig({ connections: { "acme.json": complete } });

      const result = await validateStep.run(aStepContext({ config, client: ACME_SECRET_HELD }));

      expect(result).toEqual(ACCEPTED);
    });

    it("refuses a later malformed one, naming that file", async () => {
      const config = aConfig({
        connections: {
          "a-acme.json": anOidcConnection(),
          "b-bad.json": { slug: "bad", protocol: "oidc" },
        },
      });

      const error = await rejectionOf(() => {
        return validateStep.run(aStepContext({ config, client: ACME_SECRET_HELD }));
      });

      expect(error).toBeInstanceOf(ZitadelError);
      expect(error).toMatchObject({
        code: "E_VALIDATION",
        message: expect.stringContaining(".zitadel/idps/b-bad.json"),
      });
    });

    it("refuses one naming a variable the project lacks", async () => {
      const config = aConfig({ connections: { "acme.json": anOidcConnection() } });

      const error = await rejectionOf(() => {
        return validateStep.run(aStepContext({ config, client: NOTHING_HELD }));
      });

      expect(error).toBeInstanceOf(ZitadelError);
      expect(error).toMatchObject({ code: "E_CREDENTIAL_MISSING" });
    });
  });

  describe("with a flow naming its user_schema", () => {
    it("resolves the schema by its objectType, so a field the schema lacks is refused", async () => {
      const config = aFlowNaming("human-user", ["phone_number"]);

      const error = await rejectionOf(() => {
        return validateStep.run(aStepContext({ config }));
      });

      expect(error).toBeInstanceOf(ZitadelError);
      expect(error).toMatchObject({
        code: "E_VALIDATION",
        details: {
          issues: [
            expect.objectContaining({
              message: expect.stringContaining("not a property in the user schema"),
            }),
          ],
        },
      });
    });

    it("lists the steps a refusal names under its issue", async () => {
      const flow = aLoginFlow({ userSchema: "human-user" });
      const config = aConfig({
        schemas: { "human-user.json": aUserSchema() },
        flows: {
          "default-login.json": {
            ...flow,
            steps: [{ name: "identifier", sso_providers: ["google", "google"] }],
          },
        },
      });

      const error = await rejectionOf(() => {
        return validateStep.run(aStepContext({ config }));
      });

      expect(error).toMatchObject({
        details: {
          issues: expect.arrayContaining([
            expect.objectContaining({
              steps: ["identifier"],
              path: ".zitadel/flows/default-login.json",
            }),
          ]),
        },
      });
    });

    it("accepts a field the named schema declares", async () => {
      const config = aFlowNaming("human-user", ["email"]);

      const result = await validateStep.run(aStepContext({ config }));

      expect(result).toEqual(ACCEPTED);
    });

    it("skips the schema-dependent rules for a schema only the project holds", async () => {
      const { schemas } = aProjectHolding("server-schema");
      const config = aFlowNaming("server-schema", ["phone_number"]);

      const result = await validateStep.run(aStepContext({ config, schemas }));

      expect(result).toEqual(ACCEPTED);
    });

    it("asks the project for the latest revision of a schema the configuration lacks", async () => {
      const { schemas, listSchemas } = aProjectHolding("server-schema");
      const config = aFlowNaming("server-schema", ["phone_number"]);

      await validateStep.run(aStepContext({ config, schemas }));

      expect(listSchemas).toHaveBeenCalledWith({
        project_id: PROJECT_ID,
        object_type: "server-schema",
        revisions: "latest",
        limit: 1,
      });
    });

    it("refuses a user_schema neither the configuration nor the project holds", async () => {
      const { schemas } = aProjectHolding();
      const config = aFlowNaming("missing-schema", ["email"]);

      const error = await rejectionOf(() => {
        return validateStep.run(aStepContext({ config, schemas }));
      });

      expect(error).toBeInstanceOf(ZitadelError);
      expect(error).toMatchObject({
        code: "E_VALIDATION",
        details: {
          issues: [
            {
              path: ".zitadel/flows/default-login.json",
              rule: "release/user-schema-resolves",
              message:
                'user_schema "missing-schema" is not the objectType of a schema in .zitadel/schemas/ ("human-user") or in the project.',
            },
          ],
        },
      });
    });

    it("refuses a file its contract refuses before it asks the project anything", async () => {
      const listSchemas = vi.fn(() => {
        throw new Error("the server is unreachable");
      });
      const schemas = new SchemaService(
        fakeClient({ listSchemas: { pages: listSchemas } }),
        PROJECT_ID,
      );
      const config = aConfig({
        schemas: { "human-user.json": aUserSchema(), "a.json": { objectType: "a" } },
        flows: { "default-login.json": aLoginFlow({ userSchema: "missing", collects: ["email"] }) },
      });

      const error = await rejectionOf(() => {
        return validateStep.run(aStepContext({ config, schemas }));
      });

      expect(error).toMatchObject({
        code: "E_VALIDATION",
        message: expect.stringContaining(".zitadel/schemas/a.json"),
      });
    });

    it.each(["sch_01J000000000000000000000", "https://schemas.zitadel.com/human-user/v1"])(
      "leaves a user_schema that is a schema id (%s) to the server",
      async (reference) => {
        const { schemas, listSchemas } = aProjectHolding();
        const config = aFlowNaming(reference, ["email"]);

        await validateStep.run(aStepContext({ config, schemas }));

        expect(listSchemas).not.toHaveBeenCalled();
      },
    );

    it("leaves a user_schema to the server when the configuration holds a schema-url entry", async () => {
      const { schemas, listSchemas } = aProjectHolding();
      const config = aConfig({
        schemas: { "human.json": { kind: "schema-url", url: "https://example.com/human.json" } },
        flows: { "default-login.json": aLoginFlow({ userSchema: "fetched-schema" }) },
      });

      await validateStep.run(aStepContext({ config, schemas }));

      expect(listSchemas).not.toHaveBeenCalled();
    });
  });

  describe("with a policy file", () => {
    it("passes one that is valid and named after its operation", async () => {
      const config = aConfig({ policies: { [`${PASSWORD_POLICY}.json`]: aPasswordPolicy() } });

      const result = await validateStep.run(aStepContext({ config }));

      expect(result).toEqual(ACCEPTED);
    });

    it("refuses an unknown setting or a value outside its bounds, naming the file", async () => {
      const policy = aPasswordPolicy({ min_length: 0, colour: 1 });
      const config = aConfig({ policies: { [`${PASSWORD_POLICY}.json`]: policy } });

      const error = await rejectionOf(() => {
        return validateStep.run(aStepContext({ config }));
      });

      expect(error).toBeInstanceOf(ZitadelError);
      expect(error).toMatchObject({
        code: "E_VALIDATION",
        message: expect.stringContaining(`.zitadel/policies/${PASSWORD_POLICY}.json: config`),
      });
    });

    it("refuses one not named after its operation", async () => {
      const config = aConfig({ policies: { "password.json": aPasswordPolicy() } });

      const error = await rejectionOf(() => {
        return validateStep.run(aStepContext({ config }));
      });

      expect(error).toBeInstanceOf(ZitadelError);
      expect(error).toMatchObject({
        code: "E_VALIDATION",
        message: expect.stringContaining(
          `.zitadel/policies/password.json: holds the ${PASSWORD_POLICY} policy, so it must be named ${PASSWORD_POLICY}.json`,
        ),
      });
    });
  });

  describe("with a branding descriptor", () => {
    it.each([
      ["a malformed logo_url", aBranding({ logo_url: "not-a-url" }), "logo_url"],
      [
        "the retired liquid_template_file key",
        { layout: "centered", liquid_template_file: "./login.liquid" },
        '"liquid_template": { "$file": "./login.liquid" }',
      ],
      [
        "a template that leaves out the mandatory gates",
        aBranding({ liquid_template: "<zl-page-shell></zl-page-shell>" }),
        "mandatory-gates",
      ],
      [
        "a template carrying a script tag",
        aBranding({ liquid_template: "<script>alert(1)</script>{% mandatory_gates %}" }),
        "no-script-tag",
      ],
      [
        "a $file reference that cannot be read",
        aBranding({ liquid_template: { $file: "./missing.liquid" } }),
        "missing.liquid",
      ],
    ])("refuses %s, saying why", async (_problem, branding, why) => {
      const config = aConfig({ branding: { "branding.json": branding } });

      const error = await rejectionOf(() => {
        return validateStep.run(aStepContext({ config }));
      });

      expect(error).toBeInstanceOf(ZitadelError);
      expect(error).toMatchObject({ code: "E_VALIDATION", message: expect.stringContaining(why) });
    });

    it("passes with a template read through a $file reference", async () => {
      const config = aConfig({
        branding: { "branding.json": aBranding({ liquid_template: { $file: "./login.liquid" } }) },
      });
      const store = aStore({}, { ".zitadel/branding/login.liquid": "{% mandatory_gates %}" });

      const result = await validateStep.run(aStepContext({ config, store }));

      expect(result).toEqual(ACCEPTED);
    });

    it("refuses a $file template referencing a variable the env lacks", async () => {
      const config = aConfig({
        branding: { "branding.json": aBranding({ liquid_template: { $file: "./login.liquid" } }) },
      });
      const store = aStore(
        {},
        { ".zitadel/branding/login.liquid": "<p>${BRAND_NAME}</p>{% mandatory_gates %}" },
      );

      const error = await rejectionOf(() => {
        return validateStep.run(aStepContext({ config, store }));
      });

      expect(error).toBeInstanceOf(ZitadelError);
      expect(error).toMatchObject({
        code: "E_VALIDATION",
        message: expect.stringContaining("BRAND_NAME"),
      });
    });
  });
});
