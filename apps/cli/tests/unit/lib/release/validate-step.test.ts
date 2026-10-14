import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import defaultLogin from "@zitadel/config/defaults/default-login.json" with { type: "json" };
import { afterEach, describe, expect, it } from "vitest";

import { validateStep } from "../../../../src/lib/release/steps/validate";
import type { StepContext } from "../../../../src/lib/release/pipeline";

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

let dir: string;

function ctx(
  bundle: StepContext["bundle"],
  {
    env = {},
    brandingSources = [],
    cwd = "/tmp",
  }: {
    env?: StepContext["env"];
    brandingSources?: StepContext["brandingSources"];
    cwd?: string;
  } = {},
): StepContext {
  return {
    cwd,
    client: {} as never,
    projectId: "proj_1",
    env,
    mode: "deploy",
    dryRun: false,
    json: true,
    color: false,
    bundle,
    brandingSources,
  };
}

afterEach(async () => {
  if (dir) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("validate step", () => {
  it("fails naming an environment variable a resource references but the env lacks", async () => {
    const bundle = {
      schemas: [{ objectType: "human-user", hint: "${MISSING_VAR}" }],
      flow_definitions: [],
      brandings: [],
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
      brandings: [validBranding],
    };

    await expect(
      validateStep.run(
        ctx(bundle, { env: { PRESENT_VAR: "v1" }, brandingSources: [validBranding] }),
      ),
    ).resolves.toBeUndefined();
  });

  it("rejects a malformed schema before anything is written", async () => {
    const bundle = {
      // Missing kind/metaSchema/x-auth-methods: not a valid user schema.
      schemas: [{ objectType: "human-user" }],
      flow_definitions: [],
      brandings: [],
    };

    await expect(validateStep.run(ctx(bundle))).rejects.toMatchObject({ code: "E_VALIDATION" });
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
        brandings: [],
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
        brandings: [],
      };

      await expect(validateStep.run(ctx(bundle))).resolves.toBeUndefined();
    });

    it("skips the schema-dependent rules when no schema in the bundle has that objectType", async () => {
      const bundle = {
        schemas: [validSchema],
        flow_definitions: [flowNaming("some-other-schema", ["phone_number"])],
        brandings: [],
      };

      await expect(validateStep.run(ctx(bundle))).resolves.toBeUndefined();
    });
  });

  it("rejects a malformed branding descriptor", async () => {
    const badBranding = { ...validBranding, logo_url: "not-a-url" };
    const bundle = { schemas: [], flow_definitions: [], brandings: [badBranding] };

    await expect(
      validateStep.run(ctx(bundle, { brandingSources: [badBranding] })),
    ).rejects.toMatchObject({ code: "E_VALIDATION" });
  });

  it("rejects a login template that leaves out the mandatory gates", async () => {
    const descriptor = { layout: "centered", liquid_template: "<zl-page-shell></zl-page-shell>" };
    const bundle = { schemas: [], flow_definitions: [], brandings: [descriptor] };

    await expect(validateStep.run(ctx(bundle, { brandingSources: [descriptor] }))).rejects.toThrow(
      /mandatory-gates/,
    );
  });

  it("rejects a login template that carries a script tag", async () => {
    const descriptor = {
      layout: "centered",
      liquid_template: "<script>alert(1)</script>{% mandatory_gates %}",
    };
    const bundle = { schemas: [], flow_definitions: [], brandings: [descriptor] };

    await expect(validateStep.run(ctx(bundle, { brandingSources: [descriptor] }))).rejects.toThrow(
      /no-script-tag/,
    );
  });

  it("rejects a branding $file reference that cannot be read", async () => {
    dir = await mkdtemp(join(tmpdir(), "zitadel-validate-"));
    await mkdir(join(dir, ".zitadel", "branding"), { recursive: true });
    const descriptor = { layout: "centered", liquid_template: { $file: "./missing.liquid" } };
    const bundle = { schemas: [], flow_definitions: [], brandings: [{ layout: "centered" }] };

    await expect(
      validateStep.run(ctx(bundle, { cwd: dir, brandingSources: [descriptor] })),
    ).rejects.toMatchObject({ code: "E_VALIDATION" });
  });
});
