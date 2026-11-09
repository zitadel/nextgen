import { DEFAULT_FLOW_CONFIG_PATH, DEFAULT_SCHEMA_CONFIG_PATH } from "@zitadel/config/defaults";
import { describe, expect, it } from "vitest";

import {
  Branding,
  CONFIG_DIRECTORIES,
  ConfigError,
  ConflictError,
  ConnectionExistsError,
  FileExistsError,
  Flow,
  MemoryStore,
  PasswordPolicy,
  Policy,
  PolicyTest,
  type ScaffoldOptions,
  UserSchema,
  ZitadelConfig,
} from "@/lib/zitadel";
import {
  aConfig,
  aFile,
  aPasswordPolicy,
  type ConfigDocuments,
  type DocumentsByName,
} from "@tests/helpers/config";
import { acmeSelection, googleSelection } from "@tests/helpers/idp-values";
import { PASSWORD_POLICY_FILE, PASSWORD_POLICY_TEST_FILE } from "@tests/helpers/policies";
import { thrownBy } from "@tests/helpers/thrown-value";

/**
 * The password policy's file.
 */
const POLICY = `${CONFIG_DIRECTORIES.policies}/password.json`;

/**
 * The password policy's test file.
 */
const POLICY_TEST = `${CONFIG_DIRECTORIES.policies}/password.test.json`;

/**
 * A configuration holding the password policy and its test file.
 */
const POLICY_AND_TEST: ConfigDocuments = {
  policies: {
    "password.json": { operation: "password" },
    "password.test.json": { operation: "password", cases: [] },
  },
};

/**
 * The Google connection's file.
 */
const GOOGLE = `${CONFIG_DIRECTORIES.connections}/google.json`;

/**
 * The Acme connection's file.
 */
const ACME = `${CONFIG_DIRECTORIES.connections}/acme.json`;

/**
 * A minimal password-first project, with no provider, replacing nothing.
 */
const MINIMAL: ScaffoldOptions = {
  preset: "password-first",
  useCase: "minimal",
  sso: [],
  force: false,
};

/**
 * {@link MINIMAL}, offering Google and then Acme.
 */
const WITH_PROVIDERS: ScaffoldOptions = {
  ...MINIMAL,
  sso: [{ selection: googleSelection }, { selection: acmeSelection }],
};

/**
 * A configuration holding a password policy of nine characters and at most sixty-four.
 */
const KEPT_POLICY: ConfigDocuments = {
  policies: { [PASSWORD_POLICY_FILE]: aPasswordPolicy({ max_length: 64, min_length: 9 }) },
};

/**
 * A schema, a flow and a connection, each with the editor's `$schema` pointer.
 */
const ONE_OF_EACH: ConfigDocuments = {
  schemas: {
    "human-user.json": { $schema: "../meta/user-schema.json", objectType: "human-user" },
  },
  flows: {
    "default-login.json": { $schema: "../meta/flow-definition.json", name: "default-login" },
  },
  connections: { "google.json": { $schema: "../meta/idp.json", slug: "google" } },
};

/**
 * A schema and a branding descriptor.
 */
const SCHEMA_AND_BRANDING: ConfigDocuments = {
  schemas: { "human-user.json": { objectType: "human-user" } },
  branding: { "branding.json": { layout: "centered" } },
};

/**
 * A password policy with the editor's `$schema` pointer.
 */
const POLICY_WITH_POINTER: ConfigDocuments = {
  policies: {
    [PASSWORD_POLICY_FILE]: { $schema: "../meta/policy.json", ...aPasswordPolicy() },
  },
};

/**
 * A password policy and a test file the policy test contract refuses.
 */
const POLICY_AND_BROKEN_TEST: ConfigDocuments = {
  policies: {
    [PASSWORD_POLICY_FILE]: aPasswordPolicy({}),
    [PASSWORD_POLICY_TEST_FILE]: { cases: "not a policy" },
  },
};

/**
 * Schemas of distinct object types, one per file.
 *
 * @param count - How many.
 * @returns The schemas, by file name.
 */
function schemas(count: number): DocumentsByName {
  return Object.fromEntries(
    Array.from({ length: count }, (_, i) => {
      return [`schema-${i}.json`, { objectType: `type-${i}` }];
    }),
  );
}

/**
 * The paths of a list of documents.
 *
 * @param documents - The documents.
 * @returns Their paths, in order.
 */
function pathsOf(documents: readonly { path: string }[]): readonly string[] {
  return documents.map((document) => {
    return document.path;
  });
}

describe("ZitadelConfig.with", () => {
  it.each([
    ["schema", UserSchema.create(aFile("schemas", "user.json", {})), "schemas"],
    ["flow", Flow.create(aFile("flows", "login.json", {})), "flows"],
    ["policy", Policy.create(aFile("policies", "lockout.json", {})), "policies"],
    ["branding", Branding.create(aFile("branding", "login.json", {})), "branding"],
  ] as const)("places a %s in its own collection", (_kind, document, collection) => {
    const config = ZitadelConfig.empty().with(document);

    expect(pathsOf(config[collection].all)).toEqual([document.path]);
  });

  it("places a policy test file among the policies' tests", () => {
    const test = PolicyTest.create(aFile("policies", "lockout.test.json", {}));

    const config = ZitadelConfig.empty().with(test);

    expect(pathsOf(config.policies.tests)).toEqual([test.path]);
  });

  it("replaces a policy test file at the same path, where it was", () => {
    const test = PolicyTest.create({ path: POLICY_TEST, body: { operation: "password" } });

    const config = aConfig(POLICY_AND_TEST).with(test);

    expect(config.policies.tests).toEqual([test]);
  });

  it("leaves the policies alone when a policy test file is placed", () => {
    const test = PolicyTest.create({ path: POLICY_TEST, body: { operation: "password" } });

    const config = aConfig(POLICY_AND_TEST).with(test);

    expect(pathsOf(config.policies.all)).toEqual([POLICY]);
  });
});

describe("ZitadelConfig.without", () => {
  it("removes a policy test file", () => {
    const test = PolicyTest.of({ path: POLICY_TEST, body: { operation: "password", cases: [] } });

    const config = aConfig(POLICY_AND_TEST).without(test);

    expect(config.policies.tests).toEqual([]);
  });

  it("deletes the removed policy test file's file", () => {
    const test = PolicyTest.of({ path: POLICY_TEST, body: { operation: "password", cases: [] } });

    const config = aConfig(POLICY_AND_TEST).without(test);

    expect(pathsOf(config.removedDocuments)).toEqual([POLICY_TEST]);
  });
});

describe("ZitadelConfig.changedDocuments", () => {
  it("includes a new policy test file", () => {
    const test = PolicyTest.create(aFile("policies", "lockout.test.json", {}));
    const config = ZitadelConfig.empty().with(test);

    const changed = config.changedDocuments;

    expect(pathsOf(changed)).toEqual([test.path]);
  });

  it("leaves out the documents as read", () => {
    const config = aConfig(POLICY_AND_TEST);

    const changed = config.changedDocuments;

    expect(changed).toEqual([]);
  });
});

describe("ZitadelConfig.scaffold", () => {
  describe("with no provider", () => {
    it("writes the default schema, the default flow and the password policy", () => {
      const scaffold = ZitadelConfig.empty().scaffold(MINIMAL);

      expect(scaffold.change.changedPaths).toEqual([
        DEFAULT_SCHEMA_CONFIG_PATH,
        DEFAULT_FLOW_CONFIG_PATH,
        PasswordPolicy.PATH,
      ]);
    });

    it("names the schema by its objectType on the flow", () => {
      const { schema, flow } = ZitadelConfig.empty().scaffold(MINIMAL);

      expect(flow.userSchema).toBe(schema.objectType);
    });

    it("leaves SSO off the schema", () => {
      const { schema } = ZitadelConfig.empty().scaffold(MINIMAL);

      expect(schema.isSsoEnabled).toBe(false);
    });

    it("offers no provider on the flow", () => {
      const { flow } = ZitadelConfig.empty().scaffold(MINIMAL);

      expect(flow.offersSso).toBe(false);
    });
  });

  describe("with the business use case", () => {
    it("adds companyName to the schema", () => {
      const { schema } = ZitadelConfig.empty().scaffold({ ...MINIMAL, useCase: "business" });

      expect(schema.propertyNames).toContain("companyName");
    });

    it("asks for companyName on the register step", () => {
      const { flow } = ZitadelConfig.empty().scaffold({ ...MINIMAL, useCase: "business" });

      expect(flow.findStep("register")?.fields).toEqual([
        "email",
        "givenName",
        "familyName",
        "companyName",
      ]);
    });
  });

  describe("with a password minimum", () => {
    it.each([
      { given: undefined, minimum: 15 },
      { given: 12, minimum: 12 },
      { given: null, minimum: undefined },
    ])("holds $minimum when $given was given", ({ given, minimum }) => {
      const { policy } = ZitadelConfig.empty().scaffold({ ...MINIMAL, passwordMinLength: given });

      expect(policy.readMinLength()).toBe(minimum);
    });
  });

  describe("with providers", () => {
    it("writes a connection per provider", () => {
      const scaffold = ZitadelConfig.empty().scaffold(WITH_PROVIDERS);

      expect(scaffold.change.changedPaths).toEqual(expect.arrayContaining([GOOGLE, ACME]));
    });

    it("hands back each provider with its connection, in the order chosen", () => {
      const { connections } = ZitadelConfig.empty().scaffold(WITH_PROVIDERS);

      expect(
        connections.map(({ chosen, connection }) => {
          return [chosen.selection, connection.name];
        }),
      ).toEqual([
        [googleSelection, "google"],
        [acmeSelection, "acme"],
      ]);
    });

    it("lists every provider on the schema, in the order chosen", () => {
      const { schema } = ZitadelConfig.empty().scaffold(WITH_PROVIDERS);

      expect(schema.providers).toEqual(["google", "acme"]);
    });

    it("offers every provider on the identifier step, in the order chosen", () => {
      const { flow } = ZitadelConfig.empty().scaffold(WITH_PROVIDERS);

      expect(flow.findStep("identifier")?.providers).toEqual(["google", "acme"]);
    });

    it("writes the client secret as a variable reference, never a value", () => {
      const { connections } = ZitadelConfig.empty().scaffold({
        ...MINIMAL,
        sso: [{ selection: googleSelection }],
      });

      expect(connections[0]?.connection.credentialNames.clientSecret).toBe("GOOGLE_CLIENT_SECRET");
    });
  });

  describe("when a default file is already there", () => {
    it.each([DEFAULT_SCHEMA_CONFIG_PATH, DEFAULT_FLOW_CONFIG_PATH, PasswordPolicy.PATH])(
      "refuses %s without force",
      async (path) => {
        const config = await ZitadelConfig.loadUnchecked(new MemoryStore([{ path, body: {} }]));

        const error = thrownBy(() => {
          return config.scaffold(MINIMAL);
        });

        expect(error).toBeInstanceOf(FileExistsError);
        expect(error).toMatchObject({ path });
      },
    );

    it("replaces the default schema and flow under force", async () => {
      const store = new MemoryStore([
        { path: DEFAULT_SCHEMA_CONFIG_PATH, body: { objectType: "old" } },
        { path: DEFAULT_FLOW_CONFIG_PATH, body: { name: "old" } },
      ]);
      const config = await ZitadelConfig.loadUnchecked(store);
      const scaffold = config.scaffold({ ...MINIMAL, force: true });

      await scaffold.change.save(store, { overwrite: true });

      expect([store.get(DEFAULT_SCHEMA_CONFIG_PATH), store.get(DEFAULT_FLOW_CONFIG_PATH)]).toEqual([
        scaffold.schema.body,
        scaffold.flow.body,
      ]);
    });
  });

  describe("when force keeps a password policy", () => {
    it.each([
      ["no minimum", undefined],
      ["the minimum it already holds", 9],
    ])("leaves a policy given %s unwritten", (_given, minimum) => {
      const config = aConfig(KEPT_POLICY);

      const scaffold = config.scaffold({ ...MINIMAL, passwordMinLength: minimum, force: true });

      expect(scaffold.change.changedPaths).not.toContain(PasswordPolicy.PATH);
    });

    it.each([
      { given: 20, config: { max_length: 64, min_length: 20 } },
      { given: null, config: { max_length: 64 } },
    ])("puts a minimum of $given into it, keeping its other settings", ({ given, config }) => {
      const kept = aConfig(KEPT_POLICY);

      const { policy } = kept.scaffold({ ...MINIMAL, passwordMinLength: given, force: true });

      expect(policy.readConfig()).toEqual(config);
    });

    it("refuses one that is not a valid password policy", () => {
      const config = aConfig({
        policies: { [PASSWORD_POLICY_FILE]: { operation: "auth.factor.other" } },
      });

      const error = thrownBy(() => {
        return config.scaffold({ ...MINIMAL, force: true });
      });

      expect(error).toBeInstanceOf(ConfigError);
      expect(error).toMatchObject({ details: { file: PasswordPolicy.PATH } });
    });
  });

  describe("when a chosen provider already has a connection", () => {
    it.each([false, true])("refuses its file with force %s", (force) => {
      const config = aConfig({
        connections: { "google.json": { slug: "google", template: "google" } },
      });

      const error = thrownBy(() => {
        return config.scaffold({ ...MINIMAL, sso: [{ selection: googleSelection }], force });
      });

      expect(error).toBeInstanceOf(ConnectionExistsError);
      expect(error).toMatchObject({ path: GOOGLE, selection: googleSelection });
    });

    it("refuses one another file holds, naming that file", () => {
      const config = aConfig({
        connections: { "elsewhere.json": { slug: "google", template: "google" } },
      });

      const error = thrownBy(() => {
        return config.scaffold({ ...MINIMAL, sso: [{ selection: googleSelection }] });
      });

      expect(error).toBeInstanceOf(ConnectionExistsError);
      expect(error).toMatchObject({ path: `${CONFIG_DIRECTORIES.connections}/elsewhere.json` });
    });

    it("refuses one that connects to another issuer, saying to choose another slug", () => {
      const config = aConfig({
        connections: {
          "acme.json": { slug: "acme", oidc: { issuer: "https://sso.other.example" } },
        },
      });

      const error = thrownBy(() => {
        return config.scaffold({ ...MINIMAL, sso: [{ selection: acmeSelection }] });
      });

      expect(error).toBeInstanceOf(ConflictError);
      expect(error).toMatchObject({
        hint: expect.stringContaining("Choose another slug for this connection"),
      });
    });
  });

  describe("when another connection uses a chosen provider's variables", () => {
    it("refuses the provider", () => {
      const config = aConfig({
        connections: {
          "other.json": {
            slug: "other",
            oidc: {
              issuer: "https://other.example",
              client_id: "${{ ACME_CLIENT_ID }}",
              client_secret: "${{ OTHER_CLIENT_SECRET }}",
            },
          },
        },
      });

      const error = thrownBy(() => {
        return config.scaffold({ ...MINIMAL, sso: [{ selection: acmeSelection }] });
      });

      expect(error).toBeInstanceOf(ConflictError);
    });
  });

  describe("when a connection is there for a provider nobody chose", () => {
    it("leaves it alone", () => {
      const config = aConfig({
        connections: {
          "acme.json": { slug: "acme", oidc: { issuer: "https://sso.acme.example" } },
        },
      });

      const scaffold = config.scaffold({ ...MINIMAL, sso: [{ selection: googleSelection }] });

      expect(scaffold.change.changedPaths).not.toContain(ACME);
    });
  });
});

describe("ZitadelConfig.bundle", () => {
  it("groups the resources by kind and strips the $schema affordance", () => {
    const config = aConfig(ONE_OF_EACH);

    const { bundle } = config.bundle(new MemoryStore());

    expect(bundle).toEqual({
      schemas: [{ objectType: "human-user" }],
      flow_definitions: [{ name: "default-login" }],
      idps: [{ slug: "google" }],
    });
  });

  it.each([
    ["a schema, a flow and a connection", ONE_OF_EACH, 3],
    ["a schema and the branding", SCHEMA_AND_BRANDING, 2],
    ["a policy file", POLICY_WITH_POINTER, 1],
    ["a policy file but not its test file", POLICY_AND_BROKEN_TEST, 1],
    ["exactly fifty resources", { schemas: schemas(50) }, 50],
  ])("counts %s", (_holding, documents, count) => {
    const config = aConfig(documents);

    const { resourceCount } = config.bundle(new MemoryStore());

    expect(resourceCount).toBe(count);
  });

  it("sends the branding as one object under `branding`, never a `brandings` list", () => {
    const config = aConfig(SCHEMA_AND_BRANDING);

    const { bundle } = config.bundle(new MemoryStore());

    expect(bundle.branding).toMatchObject({ layout: "centered" });
    expect(bundle).not.toHaveProperty("brandings");
  });

  it("inlines the branding's $file template and drops its $schema pointer", () => {
    const store = new MemoryStore([], { ".zitadel/branding/login.liquid": "<main></main>" });
    const config = aConfig({
      branding: {
        "branding.json": {
          $schema: "../meta/branding.json",
          liquid_template: { $file: "./login.liquid" },
        },
      },
    });

    const { bundle } = config.bundle(store);

    expect(bundle.branding).toEqual({ liquid_template: "<main></main>" });
  });

  it("carries policy files under `policies` without their $schema pointer", () => {
    const config = aConfig(POLICY_WITH_POINTER);

    const { bundle } = config.bundle(new MemoryStore());

    expect(bundle.policies).toEqual([aPasswordPolicy()]);
  });

  it("never carries a policy test file, valid or not", () => {
    const config = aConfig(POLICY_AND_BROKEN_TEST);

    const { bundle } = config.bundle(new MemoryStore());

    expect(bundle.policies).toEqual([aPasswordPolicy({})]);
  });

  it("leaves `policies` out when there are none, so a server without the kind takes it", () => {
    const config = aConfig({ schemas: { "human-user.json": { objectType: "human-user" } } });

    const { bundle } = config.bundle(new MemoryStore());

    expect(bundle).not.toHaveProperty("policies");
  });

  it("refuses an empty configuration", () => {
    const config = ZitadelConfig.empty();

    const error = thrownBy(() => {
      return config.bundle(new MemoryStore());
    });

    expect(error).toBeInstanceOf(ConfigError);
    expect(error).toMatchObject({ message: "There is nothing in .zitadel/ to deploy" });
  });

  it("refuses more than one branding descriptor", () => {
    const config = aConfig({
      branding: { "one.json": { name: "one" }, "two.json": { name: "two" } },
    });

    const error = thrownBy(() => {
      return config.bundle(new MemoryStore());
    });

    expect(error).toBeInstanceOf(ConfigError);
    expect(error).toMatchObject({
      message: "A release carries at most one branding, but .zitadel/branding/ holds 2",
    });
  });

  it("refuses a bundle over the fifty-resource cap", () => {
    const config = aConfig({ schemas: schemas(51) });

    const error = thrownBy(() => {
      return config.bundle(new MemoryStore());
    });

    expect(error).toBeInstanceOf(ConfigError);
    expect(error).toMatchObject({
      message: "A release pins at most 50 resources, but .zitadel/ holds 51",
    });
  });
});
