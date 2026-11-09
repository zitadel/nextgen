import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import defaultLogin from "@zitadel/config/defaults/default-login.json" with { type: "json" };
import { describe, expect, vi } from "vitest";

import { it } from "@tests/helpers/fixtures";

import { DeploymentService, VariableService, SchemaService, UserService } from "@/lib/backend";
import { validateStep } from "@/lib/publish/steps/validate";
import type { StepContext } from "@/lib/publish/pipeline";
import type { SuggestedCommand } from "@/lib/suggestion";
import { fakeClient, pagesOf } from "@tests/helpers/fake-client";

/** A valid user-schema the server would accept, so schema parsing passes. */
const validSchema = {
  objectType: "human-user",
  kind: "user-schema",
  metaSchema: "https://example.com/meta/user-schema.json",
  "x-auth-methods": { password: { enabled: true } },
  "x-identifier": "email",
  properties: { email: { "x-unique": "project" } },
};

/** A branding descriptor whose template lives inline, so it reads total. */
const validBranding = {
  layout: "centered",
  liquid_template: "<zl-page-shell>{% mandatory_gates %}</zl-page-shell>",
};

function ctx(
  bundle: Partial<StepContext["bundle"]>,
  {
    env = {},
    brandingSources = [],
    cwd = "/tmp",
    idpFiles = [],
    policyFiles = [],
    schemas,
  }: {
    schemas?: StepContext["schemas"];
    env?: StepContext["env"];
    brandingSources?: StepContext["brandingSources"];
    cwd?: string;
    idpFiles?: StepContext["idpFiles"];
    policyFiles?: StepContext["policyFiles"];
  } = {},
): StepContext {
  return {
    cwd,
    deployments: new DeploymentService(fakeClient({}), "proj_1"),
    variables: new VariableService(fakeClient({}), "proj_1"),
    schemas: schemas ?? new SchemaService(fakeClient({}), "proj_1"),
    users: new UserService(fakeClient({})),
    env,
    mode: "deploy",
    dryRun: false,
    json: true,
    color: false,
    bundle: { schemas: [], flow_definitions: [], idps: [], policies: [], ...bundle },
    brandingSources,
    idpFiles,
    policyFiles,
    suggest: (args) => args as SuggestedCommand,
  };
}

describe("validate step", () => {
  it("fails naming an environment variable a resource references but the env lacks", async () => {
    const bundle = {
      schemas: [{ objectType: "human-user", hint: "${MISSING_VAR}" }],
      flow_definitions: [],
    };

    await expect(validateStep.run(ctx(bundle))).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: expect.stringContaining("MISSING_VAR"),
    });
  });

  it("passes when every referenced variable resolves and every kind is valid", async () => {
    // The `${PRESENT_VAR}` rides an editor-only key the schema parse strips but
    // the env-ref scan still sees, so the schema stays valid.
    const bundle = {
      schemas: [{ ...validSchema, $comment: "${PRESENT_VAR}" }],
      flow_definitions: [],
      branding: validBranding,
    };

    await expect(
      validateStep.run(
        ctx(bundle, { env: { PRESENT_VAR: "v1" }, brandingSources: [validBranding] }),
      ),
    ).resolves.toEqual({ warnings: [] });
  });

  it("rejects a malformed schema before anything is written", async () => {
    const bundle = {
      // Missing kind/metaSchema/x-auth-methods: not a valid user schema.
      schemas: [{ objectType: "human-user" }],
      flow_definitions: [],
    };

    await expect(validateStep.run(ctx(bundle))).rejects.toMatchObject({ code: "E_VALIDATION" });
  });

  describe("a schema", () => {
    it("is refused for every key its meta-schema refuses, naming the schema and the path", async () => {
      const bundle = {
        schemas: [
          {
            ...validSchema,
            properties: {
              ...validSchema.properties,
              firstName: { type: "string", minimumLength: 3 },
              address: { type: "object", properties: { zip: { maxLenght: 5 } } },
            },
          },
        ],
        flow_definitions: [],
      };

      await expect(validateStep.run(ctx(bundle))).rejects.toMatchObject({
        code: "E_VALIDATION",
        hint: expect.stringContaining("needs a CLI as new as the server"),
        details: {
          issues: expect.arrayContaining([
            "human-user: properties.firstName minimumLength is not an allowed key. Did you mean minLength?",
            "human-user: properties.address.properties.zip maxLenght is not an allowed key. Did you mean maxLength?",
          ]),
        },
      });
    });

    it("passes as a schema-url reference, which has no user meta-schema to meet", async () => {
      const bundle = {
        schemas: [{ kind: "schema-url", url: "https://schemas.example.com/user.json" }],
        flow_definitions: [],
      };

      await expect(validateStep.run(ctx(bundle))).resolves.toEqual({ warnings: [] });
    });

    it("refuses an x-auth-methods key that is no authentication method, naming the schema", async () => {
      const schema = {
        ...validSchema,
        "x-auth-methods": { password: { enabled: true }, pasword: { enabled: true } },
      };

      await expect(validateStep.run(ctx({ schemas: [schema] }))).rejects.toMatchObject({
        code: "E_VALIDATION",
        details: {
          issues: [expect.stringMatching(/^human-user: x-auth-methods pasword is not/)],
        },
      });
    });
  });

  it("keeps the fix a literal client_secret gets, rather than the release body's pattern", async () => {
    const connection = {
      slug: "acme",
      protocol: "oidc",
      display_name: "Acme",
      oidc: {
        issuer: "https://sso.acme.example",
        client_id: "client",
        client_secret: "a-literal-secret",
        scopes: ["openid"],
      },
    };

    await expect(
      validateStep.run(ctx({ idps: [connection] }, { idpFiles: ["acme.json"] })),
    ).rejects.toMatchObject({
      message: "Connection file's client_secret must reference a variable, not hold a value",
      hint: expect.stringContaining("variable set NAME --secret"),
    });
  });

  describe("a flow's user_schema", () => {
    /** The default login flow, naming its schema `userSchema` and collecting `fields` first. */
    const flowNaming = (userSchema: string, fields: string[]) => ({
      ...defaultLogin,
      user_schema: userSchema,
      steps: defaultLogin.steps.map((step) =>
        step.name === "identifier" ? { ...step, fields } : step,
      ),
    });

    it("resolves the schema by its objectType, so a field the schema lacks is refused", async () => {
      const bundle = {
        schemas: [validSchema],
        flow_definitions: [flowNaming("human-user", ["phone_number"])],
      };

      await expect(validateStep.run(ctx(bundle))).rejects.toMatchObject({
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

    it("accepts a field the named schema declares", async () => {
      const bundle = {
        schemas: [validSchema],
        flow_definitions: [flowNaming("human-user", ["email"])],
      };

      await expect(validateStep.run(ctx(bundle))).resolves.toEqual({ warnings: [] });
    });

    /** A project holding the latest revision of each of `objectTypes`. */
    const projectHolding = (...objectTypes: string[]) => {
      const listSchemas = vi.fn(({ object_type }: { object_type?: string }) =>
        pagesOf({
          schemas: objectTypes.includes(object_type ?? "") ? [{ id: "sch_1" }] : [],
          next_page_token: null,
        }),
      );
      return {
        schemas: new SchemaService(fakeClient({ listSchemas: { pages: listSchemas } }), "proj_1"),
        listSchemas,
      };
    };

    it("skips the schema-dependent rules for a schema only the project holds", async () => {
      const { schemas, listSchemas } = projectHolding("server-schema");
      const bundle = {
        schemas: [validSchema],
        flow_definitions: [flowNaming("server-schema", ["phone_number"])],
      };

      await expect(validateStep.run(ctx(bundle, { schemas }))).resolves.toEqual({ warnings: [] });
      expect(listSchemas).toHaveBeenCalledWith({
        project_id: "proj_1",
        object_type: "server-schema",
        revisions: "latest",
        limit: 1,
      });
    });

    it("refuses a flow whose user_schema neither the bundle nor the project holds", async () => {
      const { schemas } = projectHolding();
      const bundle = {
        schemas: [validSchema],
        flow_definitions: [flowNaming("missing-schema", ["email"])],
      };

      await expect(validateStep.run(ctx(bundle, { schemas }))).rejects.toMatchObject({
        code: "E_VALIDATION",
        details: {
          issues: [
            {
              handle: defaultLogin.name,
              rule: "release/user-schema-resolves",
              message:
                'user_schema "missing-schema" is not the objectType of a schema in .zitadel/schemas/ ("human-user") or in the project.',
            },
          ],
        },
      });
    });

    it.each(["sch_01J000000000000000000000", "https://schemas.zitadel.com/human-user/v1"])(
      "leaves a user_schema that is a schema id (%s) to the server",
      async (ref) => {
        const { schemas, listSchemas } = projectHolding();
        const bundle = { schemas: [validSchema], flow_definitions: [flowNaming(ref, ["email"])] };

        await expect(validateStep.run(ctx(bundle, { schemas }))).resolves.toEqual({ warnings: [] });
        expect(listSchemas).not.toHaveBeenCalled();
      },
    );

    it("leaves a user_schema to the server when the bundle holds a schema-url entry", async () => {
      const { schemas, listSchemas } = projectHolding();
      const bundle = {
        schemas: [{ kind: "schema-url", url: "https://example.com/human.json" }],
        flow_definitions: [flowNaming("fetched-schema", ["email"])],
      };

      await expect(validateStep.run(ctx(bundle, { schemas }))).resolves.toEqual({ warnings: [] });
      expect(listSchemas).not.toHaveBeenCalled();
    });
  });

  describe("a policy file", () => {
    const policy = { operation: "auth.factor.password.set", config: { min_length: 12 } };

    it("passes when it is valid and named after its operation", async () => {
      await expect(
        validateStep.run(
          ctx({ policies: [policy] }, { policyFiles: ["auth.factor.password.set.json"] }),
        ),
      ).resolves.toEqual({ warnings: [] });
    });

    it("is refused for an unknown setting or a value outside its bounds, naming the file", async () => {
      const bad = { operation: "auth.factor.password.set", config: { min_length: 0, colour: 1 } };
      await expect(
        validateStep.run(
          ctx({ policies: [bad] }, { policyFiles: ["auth.factor.password.set.json"] }),
        ),
      ).rejects.toMatchObject({
        code: "E_VALIDATION",
        message: expect.stringContaining(".zitadel/policies/auth.factor.password.set.json: config"),
      });
    });

    it("is refused when it is not named after its operation", async () => {
      await expect(
        validateStep.run(ctx({ policies: [policy] }, { policyFiles: ["password.json"] })),
      ).rejects.toMatchObject({
        code: "E_VALIDATION",
        message: expect.stringContaining(
          ".zitadel/policies/password.json holds the auth.factor.password.set policy, so it must be named auth.factor.password.set.json",
        ),
      });
    });
  });

  it("rejects a malformed branding descriptor", async () => {
    const badBranding = { ...validBranding, logo_url: "not-a-url" };
    const bundle = { schemas: [], flow_definitions: [], branding: badBranding };

    await expect(
      validateStep.run(ctx(bundle, { brandingSources: [badBranding] })),
    ).rejects.toMatchObject({ code: "E_VALIDATION" });
  });

  it("tells a descriptor with the retired liquid_template_file key how to migrate", async () => {
    const descriptor = { layout: "centered", liquid_template_file: "./login.liquid" };
    const bundle = { schemas: [], flow_definitions: [], branding: { layout: "centered" } };

    await expect(validateStep.run(ctx(bundle, { brandingSources: [descriptor] }))).rejects.toThrow(
      /"liquid_template": \{ "\$file": "\.\/login\.liquid" \}/,
    );
  });

  it("rejects a login template that leaves out the mandatory gates", async () => {
    const descriptor = { layout: "centered", liquid_template: "<zl-page-shell></zl-page-shell>" };
    const bundle = { schemas: [], flow_definitions: [], branding: descriptor };

    await expect(validateStep.run(ctx(bundle, { brandingSources: [descriptor] }))).rejects.toThrow(
      /mandatory-gates/,
    );
  });

  it("rejects a login template that carries a script tag", async () => {
    const descriptor = {
      layout: "centered",
      liquid_template: "<script>alert(1)</script>{% mandatory_gates %}",
    };
    const bundle = { schemas: [], flow_definitions: [], branding: descriptor };

    await expect(validateStep.run(ctx(bundle, { brandingSources: [descriptor] }))).rejects.toThrow(
      /no-script-tag/,
    );
  });

  it("rejects a branding $file reference that cannot be read", async ({ dir }) => {
    await mkdir(join(dir, ".zitadel", "branding"), { recursive: true });
    const descriptor = { layout: "centered", liquid_template: { $file: "./missing.liquid" } };
    const bundle = { schemas: [], flow_definitions: [], branding: { layout: "centered" } };

    await expect(
      validateStep.run(ctx(bundle, { cwd: dir, brandingSources: [descriptor] })),
    ).rejects.toMatchObject({ code: "E_VALIDATION" });
  });
});
