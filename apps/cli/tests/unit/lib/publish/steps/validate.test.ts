import type { GetVariable200 } from "@zitadel/api/generated/model";
import defaultLogin from "@zitadel/config/defaults/default-login.json" with { type: "json" };
import { describe, expect, it, vi } from "vitest";

import { DeploymentService, VariableService, SchemaService, UserService } from "@/lib/backend";
import { ZitadelError } from "@/lib/errors";
import { validateStep } from "@/lib/publish/steps/validate";
import type { StepContext } from "@/lib/publish/pipeline";
import type { SuggestedCommand } from "@/lib/suggestion";
import {
  MemoryStore,
  ZitadelConfig,
  type ConfigFile,
  type ConfigFiles,
  type JsonObject,
} from "@/lib/zitadel";
import { isJsonObject, listAt, toJsonObject } from "@/lib/zitadel/utils/json";
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

/** A connection the server would accept: a `${{ NAME }}` client_secret. */
const validConnection = {
  slug: "acme",
  protocol: "oidc",
  display_name: "Acme",
  oidc: {
    issuer: "https://sso.acme.example",
    client_id: "client",
    client_secret: "${{ ACME_CLIENT_SECRET }}",
    scopes: ["openid"],
  },
};

/** Files of one kind, each at `.zitadel/<directory>/<name>`. */
function at(directory: string, files: Record<string, JsonObject>): ConfigFile[] {
  return Object.entries(files).map(([name, body]) => {
    return { path: `.zitadel/${directory}/${name}`, body };
  });
}

function ctx(
  files: Partial<ConfigFiles>,
  {
    env = {},
    assets = {},
    schemas,
    held = {},
    over = {},
  }: {
    schemas?: StepContext["schemas"];
    /** What the run differs in from a deploy that writes. */
    over?: Partial<StepContext>;
    env?: StepContext["env"];
    /** Files a branding `$file` reference may name, by project-relative path. */
    assets?: Record<string, string>;
    /** The variables the project holds. */
    held?: Record<string, GetVariable200["primary"]>;
  } = {},
): StepContext {
  const config = ZitadelConfig.of({
    schemas: [],
    flows: [],
    connections: [],
    policies: [],
    branding: [],
    ...files,
  });
  const store = new MemoryStore([], assets);
  const variables = fakeClient({
    getVariables: async () => {
      return Object.fromEntries(
        Object.entries(held).map(([name, value]) => {
          return [name, { primary: value }];
        }),
      );
    },
  });
  return {
    cwd: "/tmp",
    deployments: new DeploymentService(fakeClient({}), "proj_1"),
    variables: new VariableService(variables, "proj_1"),
    schemas: schemas ?? new SchemaService(fakeClient({}), "proj_1"),
    users: new UserService(fakeClient({})),
    env,
    mode: "deploy",
    dryRun: false,
    json: true,
    color: false,
    config,
    store,
    bundle: config.bundle(store).bundle,
    suggest: (args) => {
      return `${args} --env staging` as SuggestedCommand;
    },
    ...over,
  };
}

describe("validate step", () => {
  it("fails naming an environment variable a resource references but the env lacks", async () => {
    const files = {
      schemas: at("schemas", {
        "human-user.json": { objectType: "human-user", hint: "${MISSING_VAR}" },
      }),
    };

    await expect(validateStep.run(ctx(files))).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: expect.stringContaining("MISSING_VAR"),
    });
  });

  it("passes when every referenced variable resolves and every kind is valid", async () => {
    // The `${PRESENT_VAR}` rides an editor-only key the schema parse strips but
    // the env-ref scan still sees, so the schema stays valid.
    const files = {
      schemas: at("schemas", { "human-user.json": { ...validSchema, $comment: "${PRESENT_VAR}" } }),
      branding: at("branding", { "branding.json": validBranding }),
    };

    await expect(validateStep.run(ctx(files, { env: { PRESENT_VAR: "v1" } }))).resolves.toEqual({
      warnings: [],
    });
  });

  it("rejects a malformed schema before anything is written", async () => {
    // Missing kind/metaSchema/x-auth-methods: not a valid user schema.
    const files = { schemas: at("schemas", { "human-user.json": { objectType: "human-user" } }) };

    await expect(validateStep.run(ctx(files))).rejects.toMatchObject({ code: "E_VALIDATION" });
  });

  it("refuses an x-auth-methods key that is no authentication method, naming the schema", async () => {
    const schema = {
      ...validSchema,
      "x-auth-methods": { password: { enabled: true }, pasword: { enabled: true } },
    };

    await expect(
      validateStep.run(ctx({ schemas: at("schemas", { "human-user.json": schema }) })),
    ).rejects.toMatchObject({
      code: "E_VALIDATION",
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

  it("names every refused file in one refusal", async () => {
    const files = {
      schemas: at("schemas", {
        "a.json": { objectType: "a" },
        "b.json": { objectType: "b" },
      }),
    };

    await expect(validateStep.run(ctx(files))).rejects.toMatchObject({
      message: expect.stringMatching(
        /\.zitadel\/schemas\/a\.json[\s\S]*\.zitadel\/schemas\/b\.json/,
      ),
    });
  });

  describe("a connection file", () => {
    const literal = {
      ...validConnection,
      oidc: { ...validConnection.oidc, client_secret: "a-literal-secret" },
    };

    it("is refused for a literal client_secret, naming the file", async () => {
      await expect(
        validateStep.run(ctx({ connections: at("idps", { "acme.json": literal }) })),
      ).rejects.toMatchObject({
        code: "E_VALIDATION",
        message: expect.stringContaining(
          ".zitadel/idps/acme.json: client_secret must reference a variable, not hold a value",
        ),
      });
    });

    it("tells a literal client_secret how to publish it, in the deploy's environment", async () => {
      await expect(
        validateStep.run(ctx({ connections: at("idps", { "acme.json": literal }) })),
      ).rejects.toMatchObject({
        hint: expect.stringContaining("variable set NAME --secret --env staging"),
      });
    });

    it.each([
      ["on a dry run", { dryRun: true }],
      ["for a preview", { mode: "preview" }],
    ] as const)("is refused for a literal client_secret %s too", async (_run, over) => {
      await expect(
        validateStep.run(ctx({ connections: at("idps", { "acme.json": literal }) }, { over })),
      ).rejects.toMatchObject({ code: "E_VALIDATION" });
    });

    it("is refused for a literal client_secret in a later one after an earlier one passes", async () => {
      const files = {
        connections: at("idps", { "a-acme.json": validConnection, "b-acme.json": literal }),
      };

      await expect(
        validateStep.run(ctx(files, { held: { ACME_CLIENT_SECRET: { secret: true } } })),
      ).rejects.toMatchObject({
        code: "E_VALIDATION",
        message: expect.stringContaining(".zitadel/idps/b-acme.json: client_secret must reference"),
      });
    });

    it("is refused for a literal client_secret before the project's variables are read", async () => {
      const getVariables = vi.fn(async () => {
        return {};
      });
      const variables = new VariableService(fakeClient({ getVariables }), "proj_1");

      await validateStep
        .run(ctx({ connections: at("idps", { "acme.json": literal }) }, { over: { variables } }))
        .catch(() => {
          return undefined;
        });

      expect(getVariables).not.toHaveBeenCalled();
    });

    it("never echoes a literal client_secret in the refusal", async () => {
      const error: unknown = await validateStep
        .run(ctx({ connections: at("idps", { "acme.json": literal }) }))
        .catch((thrown: unknown) => {
          return thrown;
        });

      expect(error).toBeInstanceOf(ZitadelError);
      const { message, hint, details } = error as ZitadelError;
      expect(JSON.stringify({ message, hint, details })).not.toContain("a-literal-secret");
    });

    it("is refused when its oidc block names some endpoints but not the rest", async () => {
      const partial = {
        ...validConnection,
        oidc: { ...validConnection.oidc, authorization_endpoint: "https://sso.acme.example/auth" },
      };

      await expect(
        validateStep.run(ctx({ connections: at("idps", { "acme.json": partial }) })),
      ).rejects.toThrow(
        /\.zitadel\/idps\/acme\.json: oidc names some endpoints but not jwks_uri, token_endpoint, userinfo_endpoint/,
      );
    });

    it("passes when its oidc block names every endpoint", async () => {
      const complete = {
        ...validConnection,
        oidc: {
          ...validConnection.oidc,
          authorization_endpoint: "https://sso.acme.example/auth",
          jwks_uri: "https://sso.acme.example/jwks",
          token_endpoint: "https://sso.acme.example/token",
          userinfo_endpoint: "https://sso.acme.example/userinfo",
        },
      };

      await expect(
        validateStep.run(
          ctx(
            { connections: at("idps", { "acme.json": complete }) },
            { held: { ACME_CLIENT_SECRET: { secret: true } } },
          ),
        ),
      ).resolves.toEqual({ warnings: [] });
    });

    it("is refused when a later one is malformed, naming that file", async () => {
      const files = {
        connections: at("idps", {
          "a-acme.json": validConnection,
          "b-bad.json": { slug: "bad", protocol: "oidc" },
        }),
      };

      await expect(
        validateStep.run(ctx(files, { held: { ACME_CLIENT_SECRET: { secret: true } } })),
      ).rejects.toMatchObject({
        code: "E_VALIDATION",
        message: expect.stringContaining(".zitadel/idps/b-bad.json"),
      });
    });

    it("is refused when it names a variable the project lacks", async () => {
      await expect(
        validateStep.run(ctx({ connections: at("idps", { "acme.json": validConnection }) })),
      ).rejects.toMatchObject({ code: "E_CREDENTIAL_MISSING" });
    });
  });

  describe("a flow's user_schema", () => {
    /** The default login flow, naming its schema `userSchema` and collecting `fields` first. */
    const flowNaming = (userSchema: string, fields: string[]): JsonObject => {
      const login = toJsonObject(defaultLogin, "The default login flow");
      return {
        ...login,
        user_schema: userSchema,
        steps: listAt(login, "steps").map((step) => {
          if (isJsonObject(step) && step.name === "identifier") {
            return { ...step, fields };
          }
          return step;
        }),
      };
    };

    /** The schema file and a default login flow naming `userSchema`. */
    const filesNaming = (userSchema: string, fields: string[]) => {
      return {
        schemas: at("schemas", { "human-user.json": validSchema }),
        flows: at("flows", { "default-login.json": flowNaming(userSchema, fields) }),
      };
    };

    it("resolves the schema by its objectType, so a field the schema lacks is refused", async () => {
      await expect(
        validateStep.run(ctx(filesNaming("human-user", ["phone_number"]))),
      ).rejects.toMatchObject({
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
      await expect(validateStep.run(ctx(filesNaming("human-user", ["email"])))).resolves.toEqual({
        warnings: [],
      });
    });

    /** A project holding the latest revision of each of `objectTypes`. */
    const projectHolding = (...objectTypes: string[]) => {
      const listSchemas = vi.fn(({ object_type }: { object_type?: string }) => {
        return pagesOf({
          schemas: objectTypes.includes(object_type ?? "") ? [{ id: "sch_1" }] : [],
          next_page_token: null,
        });
      });
      return {
        schemas: new SchemaService(fakeClient({ listSchemas: { pages: listSchemas } }), "proj_1"),
        listSchemas,
      };
    };

    it("skips the schema-dependent rules for a schema only the project holds", async () => {
      const { schemas, listSchemas } = projectHolding("server-schema");

      await expect(
        validateStep.run(ctx(filesNaming("server-schema", ["phone_number"]), { schemas })),
      ).resolves.toEqual({ warnings: [] });
      expect(listSchemas).toHaveBeenCalledWith({
        project_id: "proj_1",
        object_type: "server-schema",
        revisions: "latest",
        limit: 1,
      });
    });

    it("refuses a flow whose user_schema neither the configuration nor the project holds", async () => {
      const { schemas } = projectHolding();

      await expect(
        validateStep.run(ctx(filesNaming("missing-schema", ["email"]), { schemas })),
      ).rejects.toMatchObject({
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

    it.each(["sch_01J000000000000000000000", "https://schemas.zitadel.com/human-user/v1"])(
      "leaves a user_schema that is a schema id (%s) to the server",
      async (ref) => {
        const { schemas, listSchemas } = projectHolding();

        await expect(
          validateStep.run(ctx(filesNaming(ref, ["email"]), { schemas })),
        ).resolves.toEqual({ warnings: [] });
        expect(listSchemas).not.toHaveBeenCalled();
      },
    );

    it("leaves a user_schema to the server when the configuration holds a schema-url entry", async () => {
      const { schemas, listSchemas } = projectHolding();
      const files = {
        schemas: at("schemas", {
          "human.json": { kind: "schema-url", url: "https://example.com/human.json" },
        }),
        flows: at("flows", { "default-login.json": flowNaming("fetched-schema", ["email"]) }),
      };

      await expect(validateStep.run(ctx(files, { schemas }))).resolves.toEqual({ warnings: [] });
      expect(listSchemas).not.toHaveBeenCalled();
    });
  });

  describe("a policy file", () => {
    const policy = { operation: "auth.factor.password.set", config: { min_length: 12 } };

    it("passes when it is valid and named after its operation", async () => {
      await expect(
        validateStep.run(
          ctx({ policies: at("policies", { "auth.factor.password.set.json": policy }) }),
        ),
      ).resolves.toEqual({ warnings: [] });
    });

    it("is refused for an unknown setting or a value outside its bounds, naming the file", async () => {
      const bad = { operation: "auth.factor.password.set", config: { min_length: 0, colour: 1 } };

      await expect(
        validateStep.run(
          ctx({ policies: at("policies", { "auth.factor.password.set.json": bad }) }),
        ),
      ).rejects.toMatchObject({
        code: "E_VALIDATION",
        message: expect.stringContaining(".zitadel/policies/auth.factor.password.set.json: config"),
      });
    });

    it("is refused when it is not named after its operation", async () => {
      await expect(
        validateStep.run(ctx({ policies: at("policies", { "password.json": policy }) })),
      ).rejects.toMatchObject({
        code: "E_VALIDATION",
        message: expect.stringContaining(
          ".zitadel/policies/password.json: holds the auth.factor.password.set policy, so it must be named auth.factor.password.set.json",
        ),
      });
    });
  });

  describe("a branding descriptor", () => {
    it("is refused when malformed", async () => {
      const badBranding = { ...validBranding, logo_url: "not-a-url" };

      await expect(
        validateStep.run(ctx({ branding: at("branding", { "branding.json": badBranding }) })),
      ).rejects.toMatchObject({ code: "E_VALIDATION" });
    });

    it("with the retired liquid_template_file key is told how to migrate", async () => {
      const descriptor = { layout: "centered", liquid_template_file: "./login.liquid" };

      await expect(
        validateStep.run(ctx({ branding: at("branding", { "branding.json": descriptor }) })),
      ).rejects.toThrow(/"liquid_template": \{ "\$file": "\.\/login\.liquid" \}/);
    });

    it("is refused when its template leaves out the mandatory gates", async () => {
      const descriptor = { layout: "centered", liquid_template: "<zl-page-shell></zl-page-shell>" };

      await expect(
        validateStep.run(ctx({ branding: at("branding", { "branding.json": descriptor }) })),
      ).rejects.toThrow(/mandatory-gates/);
    });

    it("is refused when its template carries a script tag", async () => {
      const descriptor = {
        layout: "centered",
        liquid_template: "<script>alert(1)</script>{% mandatory_gates %}",
      };

      await expect(
        validateStep.run(ctx({ branding: at("branding", { "branding.json": descriptor }) })),
      ).rejects.toThrow(/no-script-tag/);
    });

    it("is refused when a $file reference cannot be read", async () => {
      const descriptor = { layout: "centered", liquid_template: { $file: "./missing.liquid" } };

      await expect(
        validateStep.run(ctx({ branding: at("branding", { "branding.json": descriptor }) })),
      ).rejects.toMatchObject({ code: "E_VALIDATION" });
    });

    it("passes with a template read through a $file reference", async () => {
      const descriptor = { layout: "centered", liquid_template: { $file: "./login.liquid" } };

      await expect(
        validateStep.run(
          ctx(
            { branding: at("branding", { "branding.json": descriptor }) },
            { assets: { ".zitadel/branding/login.liquid": validBranding.liquid_template } },
          ),
        ),
      ).resolves.toEqual({ warnings: [] });
    });

    it("is refused when its $file template references a variable the env lacks", async () => {
      const descriptor = { layout: "centered", liquid_template: { $file: "./login.liquid" } };

      await expect(
        validateStep.run(
          ctx(
            { branding: at("branding", { "branding.json": descriptor }) },
            {
              assets: {
                ".zitadel/branding/login.liquid": "<p>${BRAND_NAME}</p>{% mandatory_gates %}",
              },
            },
          ),
        ),
      ).rejects.toMatchObject({
        code: "E_VALIDATION",
        message: expect.stringContaining("BRAND_NAME"),
      });
    });
  });
});
