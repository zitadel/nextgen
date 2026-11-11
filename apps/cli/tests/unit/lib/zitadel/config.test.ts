import { DEFAULT_FLOW_CONFIG_PATH, DEFAULT_SCHEMA_CONFIG_PATH } from "@zitadel/config/defaults";
import { describe, expect, it } from "vitest";

import {
  BrokenFile,
  BrokenFilesError,
  Branding,
  CONFIG_DIRECTORIES,
  ConfigError,
  ConflictError,
  ConnectionExistsError,
  FileExistsError,
  Flow,
  PasswordPolicy,
  Policy,
  PolicyTest,
  type ConfigKind,
  type ScaffoldOptions,
  type StoredFile,
  UserSchema,
  ZitadelConfig,
} from "@/lib/zitadel";
import { MemoryStore } from "@tests/helpers/storage/backend/memory";
import { withoutKey } from "@/lib/zitadel/utils/json";
import {
  aBranding,
  aConfig,
  aFile,
  aGoogleConnection,
  aLoginFlow,
  anOidcConnection,
  aPasswordPolicy,
  aStore,
  aStoreHolding,
  aUserSchema,
  bodyAt,
  type ConfigDocuments,
  type DocumentsByName,
} from "@tests/helpers/config";
import { acmeSelection, googleSelection } from "@tests/helpers/idp-values";
import {
  aPolicyTest,
  PASSWORD_POLICY_FILE,
  PASSWORD_POLICY_TEST_FILE,
} from "@tests/helpers/policies";
import { rejectionOf, thrownBy } from "@tests/helpers/thrown-value";

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
    "password.json": aPasswordPolicy(),
    "password.test.json": aPolicyTest(),
  },
};

/**
 * Where the broken schema in these tests sits.
 */
const BROKEN_SCHEMA = `${CONFIG_DIRECTORIES.schemas}/broken.json`;

/**
 * A configuration holding a sound schema and one the schema contract refuses.
 */
const SOUND_AND_BROKEN: ConfigDocuments = {
  schemas: { "broken.json": {}, "human-user.json": aUserSchema() },
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
    "human-user.json": { $schema: "../meta/user-schema.json", ...aUserSchema() },
  },
  flows: {
    "default-login.json": { $schema: "../meta/flow-definition.json", ...aLoginFlow() },
  },
  connections: { "google.json": { $schema: "../meta/idp.json", ...aGoogleConnection() } },
};

/**
 * A schema and a branding descriptor.
 */
const SCHEMA_AND_BRANDING: ConfigDocuments = {
  schemas: { "human-user.json": aUserSchema() },
  branding: { "branding.json": aBranding() },
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
      return [`schema-${i}.json`, aUserSchema({ objectType: `type-${i}` })];
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

/**
 * A store whose one connection file could not be parsed, as a disk store
 * hands one on.
 *
 * @param path - The file's project-relative path.
 * @returns The store.
 */
function aStoreWithUnparsed(path: string): MemoryStore {
  return aStoreHolding([], { [path]: "{ not json" });
}

describe("ZitadelConfig.of", () => {
  it("holds a file its contract refuses as a broken file", () => {
    const config = aConfig(SOUND_AND_BROKEN);

    const broken = config.broken;

    expect(broken).toEqual([expect.any(BrokenFile)]);
  });

  it("files the broken file under the kind of its directory", () => {
    const config = aConfig(SOUND_AND_BROKEN);

    const broken = config.broken;

    expect(broken).toMatchObject([{ path: BROKEN_SCHEMA, kind: "schema" }]);
  });

  it("leaves the broken file out of its collection", () => {
    const config = aConfig(SOUND_AND_BROKEN);

    const schemas = pathsOf(config.schemas.all);

    expect(schemas).toEqual([`${CONFIG_DIRECTORIES.schemas}/human-user.json`]);
  });

  it("holds the connections in the order given, which is the store's order", () => {
    const config = aConfig({
      connections: {
        "B.json": aGoogleConnection(),
        "a-b.json": aGoogleConnection(),
        "a_b.json": aGoogleConnection(),
      },
    });

    const paths = pathsOf(config.connections.all);

    expect(paths).toEqual([
      `${CONFIG_DIRECTORIES.connections}/B.json`,
      `${CONFIG_DIRECTORIES.connections}/a-b.json`,
      `${CONFIG_DIRECTORIES.connections}/a_b.json`,
    ]);
  });

  it("holds a broken policy test file as one of its own kind", () => {
    const config = aConfig(POLICY_AND_BROKEN_TEST);

    const broken = config.broken;

    expect(broken).toMatchObject([{ kind: "policy-test" }]);
  });
});

describe("ZitadelConfig.load", () => {
  it("refuses a configuration holding a broken file", async () => {
    const store = aStore(SOUND_AND_BROKEN);

    const error = await rejectionOf(() => {
      return ZitadelConfig.load(store);
    });

    expect(error).toBeInstanceOf(BrokenFilesError);
  });

  it("names the broken file", async () => {
    const store = aStore(SOUND_AND_BROKEN);

    const error = await rejectionOf(() => {
      return ZitadelConfig.load(store);
    });

    expect(error).toMatchObject({ problems: [expect.objectContaining({ path: BROKEN_SCHEMA })] });
  });

  it("refuses a file that could not be parsed, naming it", async () => {
    const path = `${CONFIG_DIRECTORIES.connections}/half-written.json`;
    const store = aStoreWithUnparsed(path);

    const error = await rejectionOf(() => {
      return ZitadelConfig.load(store);
    });

    expect(error).toMatchObject({ problems: [expect.objectContaining({ path })] });
  });

  it("leaves a broken policy test file to the command that runs it", async () => {
    const store = aStore(POLICY_AND_BROKEN_TEST);

    const config = await ZitadelConfig.load(store);

    expect(pathsOf(config.policies.all)).toEqual([
      `${CONFIG_DIRECTORIES.policies}/${PASSWORD_POLICY_FILE}`,
    ]);
  });
});

/**
 * A store whose reads of the kinds given fail, each after its own delay.
 */
class FailingStore extends MemoryStore {
  /**
   * How long each failing kind takes to fail, in milliseconds.
   */
  private readonly delays: ReadonlyMap<ConfigKind, number>;

  /**
   * A store whose reads of some kinds fail.
   *
   * @param delays - How long each failing kind takes to fail, in milliseconds.
   */
  constructor(delays: ReadonlyMap<ConfigKind, number>) {
    super();
    this.delays = delays;
  }

  /**
   * Fail for a kind that fails, after its delay; read as usual otherwise.
   *
   * @param kind - The kind of file to read.
   * @returns The files, for a kind that does not fail.
   * @throws {@link Error} Naming the kind, for a kind that fails.
   */
  override async read(kind: ConfigKind): Promise<readonly StoredFile[]> {
    const delay = this.delays.get(kind);
    if (delay === undefined) {
      return super.read(kind);
    }
    await new Promise((resolve) => {
      setTimeout(resolve, delay);
    });
    throw new Error(`cannot read ${kind}`);
  }
}

describe("ZitadelConfig.loadUnchecked", () => {
  it("names the first unreadable kind in the kinds' order, whichever fails first", async () => {
    const store = new FailingStore(
      new Map<ConfigKind, number>([
        ["branding", 0],
        ["flows", 30],
      ]),
    );

    const error = await rejectionOf(() => {
      return ZitadelConfig.loadUnchecked(store);
    });

    expect(error).toEqual(new Error("cannot read flows"));
  });

  it("keeps a broken file on the configuration", async () => {
    const store = aStore(SOUND_AND_BROKEN);

    const config = await ZitadelConfig.loadUnchecked(store);

    expect(pathsOf(config.broken)).toEqual([BROKEN_SCHEMA]);
  });

  it.each([
    ["schemas", "schema"],
    ["flows", "flow"],
    ["connections", "connection"],
    ["policies", "policy"],
    ["branding", "branding"],
  ] as const)("keeps an unparsed file of %s as a broken %s", async (directory, kind) => {
    const path = `${CONFIG_DIRECTORIES[directory]}/half-written.json`;
    const store = aStoreWithUnparsed(path);

    const config = await ZitadelConfig.loadUnchecked(store);

    expect(config.broken).toMatchObject([
      { path, kind, issues: [{ message: "cannot be parsed: invalid JSON at line 1, column 3" }] },
    ]);
  });

  it("keeps a file that could not be parsed as a broken file, beside the rest", async () => {
    const path = `${CONFIG_DIRECTORIES.connections}/half-written.json`;
    const store = aStoreWithUnparsed(path);

    const config = await ZitadelConfig.loadUnchecked(store);

    expect(config.broken).toMatchObject([
      {
        path,
        kind: "connection",
        issues: [
          {
            rule: "contract/connection",
            message: "cannot be parsed: invalid JSON at line 1, column 3",
          },
        ],
      },
    ]);
  });
});

describe("ZitadelConfig.loadKinds", () => {
  it("does not read a kind it was not asked for, so its failure does not stop the load", async () => {
    const store = new FailingStore(new Map<ConfigKind, number>([["schemas", 0]]));

    const config = await ZitadelConfig.loadKinds(store, ["flows", "connections"]);

    expect(config.schemas.all).toEqual([]);
  });

  it("names a kind it was asked for that cannot be read", async () => {
    const store = new FailingStore(new Map<ConfigKind, number>([["connections", 0]]));

    const error = await rejectionOf(() => {
      return ZitadelConfig.loadKinds(store, ["connections"]);
    });

    expect(error).toEqual(new Error("cannot read connections"));
  });

  it("holds the kinds it was asked for and leaves the others empty", async () => {
    const store = aStore(ONE_OF_EACH);

    const config = await ZitadelConfig.loadKinds(store, ["schemas"]);

    expect([
      config.schemas.all.length,
      config.flows.all.length,
      config.branding.all.length,
    ]).toEqual([1, 0, 0]);
  });

  it("keeps the broken files of the kinds it read only", async () => {
    const store = aStore(SOUND_AND_BROKEN);

    const config = await ZitadelConfig.loadKinds(store, ["flows"]);

    expect(config.broken).toEqual([]);
  });
});

describe("ZitadelConfig.findBroken", () => {
  it("finds the broken file at a path", () => {
    const config = aConfig(SOUND_AND_BROKEN);

    const broken = config.findBroken(BROKEN_SCHEMA);

    expect(broken?.path).toBe(BROKEN_SCHEMA);
  });

  it("finds nothing at the path of a document", () => {
    const config = aConfig(SOUND_AND_BROKEN);

    const broken = config.findBroken(`${CONFIG_DIRECTORIES.schemas}/human-user.json`);

    expect(broken).toBeUndefined();
  });
});

describe("ZitadelConfig.with", () => {
  it.each([
    ["schema", UserSchema.create(aFile("schemas", "user.json", aUserSchema())), "schemas"],
    ["flow", Flow.create(aFile("flows", "login.json", aLoginFlow())), "flows"],
    ["policy", Policy.create(aFile("policies", "lockout.json", aPasswordPolicy())), "policies"],
    ["branding", Branding.create(aFile("branding", "login.json", aBranding())), "branding"],
  ] as const)("places a %s in its own collection", (_kind, document, collection) => {
    const config = ZitadelConfig.empty().with(document);

    expect(pathsOf(config[collection].all)).toEqual([document.path]);
  });

  it("places a policy test file among the policies' tests", () => {
    const test = PolicyTest.create(aFile("policies", "lockout.test.json", aPolicyTest()));

    const config = ZitadelConfig.empty().with(test);

    expect(pathsOf(config.policies.tests)).toEqual([test.path]);
  });

  it("replaces a policy test file at the same path, where it was", () => {
    const test = PolicyTest.create({ path: POLICY_TEST, body: aPolicyTest() });

    const config = aConfig(POLICY_AND_TEST).with(test);

    expect(config.policies.tests).toEqual([test]);
  });

  it("no longer reports a broken file a document is written over", () => {
    const schema = UserSchema.create({ path: BROKEN_SCHEMA, body: aUserSchema() });

    const config = aConfig(SOUND_AND_BROKEN).with(schema);

    expect(config.broken).toEqual([]);
  });

  it("leaves the policies alone when a policy test file is placed", () => {
    const test = PolicyTest.create({ path: POLICY_TEST, body: aPolicyTest() });

    const config = aConfig(POLICY_AND_TEST).with(test);

    expect(pathsOf(config.policies.all)).toEqual([POLICY]);
  });
});

describe("ZitadelConfig.without", () => {
  it("removes a policy test file", () => {
    const test = PolicyTest.of({ path: POLICY_TEST, body: aPolicyTest() });

    const config = aConfig(POLICY_AND_TEST).without(test);

    expect(config.policies.tests).toEqual([]);
  });

  it("deletes the removed policy test file's file", () => {
    const test = PolicyTest.of({ path: POLICY_TEST, body: aPolicyTest() });

    const config = aConfig(POLICY_AND_TEST).without(test);

    expect(pathsOf(config.removedDocuments)).toEqual([POLICY_TEST]);
  });

  it("still deletes the file when a removed document is recreated and removed again", () => {
    const test = PolicyTest.of({ path: POLICY_TEST, body: aPolicyTest() });
    const recreated = PolicyTest.create({ path: POLICY_TEST, body: aPolicyTest() });

    const config = aConfig(POLICY_AND_TEST).without(test).with(recreated).without(recreated);

    expect(pathsOf(config.removedDocuments)).toEqual([POLICY_TEST]);
  });

  it("deletes nothing for a removed document that is recreated", () => {
    const test = PolicyTest.of({ path: POLICY_TEST, body: aPolicyTest() });
    const recreated = PolicyTest.create({ path: POLICY_TEST, body: aPolicyTest() });

    const config = aConfig(POLICY_AND_TEST).without(test).with(recreated);

    expect(config.removedDocuments).toEqual([]);
  });

  it("deletes the file a created document replaced when the document is removed", () => {
    const replacement = PolicyTest.create({ path: POLICY_TEST, body: aPolicyTest() });

    const config = aConfig(POLICY_AND_TEST).with(replacement).without(replacement);

    expect(pathsOf(config.removedDocuments)).toEqual([POLICY_TEST]);
  });

  it("deletes nothing for a created document that replaced no file", () => {
    const created = PolicyTest.create(aFile("policies", "lockout.test.json", aPolicyTest()));

    const config = ZitadelConfig.empty().with(created).without(created);

    expect(config.removedDocuments).toEqual([]);
  });
});

describe("ZitadelConfig.changedDocuments", () => {
  it("includes a new policy test file", () => {
    const test = PolicyTest.create(aFile("policies", "lockout.test.json", aPolicyTest()));
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

      expect(policy.minLength).toBe(minimum);
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
          return [chosen.selection, connection.slug];
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

      expect(connections[0]?.connection.credentials?.clientSecret).toEqual({
        kind: "variable",
        field: "client_secret",
        variable: "GOOGLE_CLIENT_SECRET",
      });
    });
  });

  describe("when a default file is already there", () => {
    it.each([DEFAULT_SCHEMA_CONFIG_PATH, DEFAULT_FLOW_CONFIG_PATH, PasswordPolicy.PATH])(
      "refuses %s without force",
      async (path) => {
        const config = await ZitadelConfig.loadUnchecked(aStoreHolding([{ path, body: {} }]));

        const error = thrownBy(() => {
          return config.scaffold(MINIMAL);
        });

        expect(error).toBeInstanceOf(FileExistsError);
        expect(error).toMatchObject({ path });
      },
    );

    it("replaces the default schema and flow under force", async () => {
      const store = aStoreHolding([
        { path: DEFAULT_SCHEMA_CONFIG_PATH, body: aUserSchema({ objectType: "old" }) },
        { path: DEFAULT_FLOW_CONFIG_PATH, body: aLoginFlow({ name: "old" }) },
      ]);
      const config = await ZitadelConfig.loadUnchecked(store);
      const scaffold = config.scaffold({ ...MINIMAL, force: true });

      await scaffold.change.save(store, { overwrite: true });

      expect([
        bodyAt(store, DEFAULT_SCHEMA_CONFIG_PATH),
        bodyAt(store, DEFAULT_FLOW_CONFIG_PATH),
      ]).toEqual([scaffold.schema.body, scaffold.flow.body]);
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

      expect(policy.config).toEqual(config);
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
      const config = aConfig({ connections: { "google.json": aGoogleConnection() } });

      const error = thrownBy(() => {
        return config.scaffold({ ...MINIMAL, sso: [{ selection: googleSelection }], force });
      });

      expect(error).toBeInstanceOf(ConnectionExistsError);
      expect(error).toMatchObject({ path: GOOGLE, selection: googleSelection });
    });

    it("refuses one another file holds, naming that file", () => {
      const config = aConfig({ connections: { "elsewhere.json": aGoogleConnection() } });

      const error = thrownBy(() => {
        return config.scaffold({ ...MINIMAL, sso: [{ selection: googleSelection }] });
      });

      expect(error).toBeInstanceOf(ConnectionExistsError);
      expect(error).toMatchObject({ path: `${CONFIG_DIRECTORIES.connections}/elsewhere.json` });
    });

    it("refuses its file when it holds a broken connection", () => {
      const config = aConfig({ connections: { "google.json": {} } });

      const error = thrownBy(() => {
        return config.scaffold({ ...MINIMAL, sso: [{ selection: googleSelection }] });
      });

      expect(error).toBeInstanceOf(ConnectionExistsError);
      expect(error).toMatchObject({ path: GOOGLE, selection: googleSelection });
    });

    it("refuses its file when it holds a connection under another slug", () => {
      const config = aConfig({
        connections: { "google.json": aGoogleConnection({ slug: "something-else" }) },
      });

      const error = thrownBy(() => {
        return config.scaffold({ ...MINIMAL, sso: [{ selection: googleSelection }] });
      });

      expect(error).toBeInstanceOf(ConflictError);
    });

    it("refuses one that connects to another issuer, saying to choose another slug", () => {
      const config = aConfig({
        connections: {
          "acme.json": anOidcConnection({ oidc: { issuer: "https://sso.other.example" } }),
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
          "other.json": anOidcConnection({
            slug: "other",
            display_name: "Other",
            oidc: {
              issuer: "https://other.example",
              client_id: "${{ ACME_CLIENT_ID }}",
              client_secret: "${{ OTHER_CLIENT_SECRET }}",
            },
          }),
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
        connections: { "acme.json": anOidcConnection() },
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
      schemas: [aUserSchema()],
      flow_definitions: [withoutKey(aLoginFlow(), "$schema")],
      idps: [aGoogleConnection()],
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
    const store = aStoreHolding([], { ".zitadel/branding/login.liquid": "<main></main>" });
    const config = aConfig({
      branding: {
        "branding.json": {
          $schema: "../meta/branding.json",
          ...aBranding({ liquid_template: { $file: "./login.liquid" } }),
        },
      },
    });

    const { bundle } = config.bundle(store);

    expect(bundle.branding).toEqual(aBranding({ liquid_template: "<main></main>" }));
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
    const config = aConfig({ schemas: { "human-user.json": aUserSchema() } });

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

  it("leaves a configuration of broken files to its validation, rather than calling it empty", () => {
    const config = aConfig({ schemas: { "broken.json": {} } });

    const { resourceCount } = config.bundle(new MemoryStore());

    expect(resourceCount).toBe(0);
  });

  it("counts a broken file towards the fifty-resource cap", () => {
    const config = aConfig({ schemas: { ...schemas(50), "broken.json": {} } });

    const error = thrownBy(() => {
      return config.bundle(new MemoryStore());
    });

    expect(error).toMatchObject({
      message: "A release pins at most 50 resources, but .zitadel/ holds 51",
    });
  });

  it("counts a broken branding descriptor among the descriptors", () => {
    const config = aConfig({ branding: { "one.json": aBranding(), "two.json": {} } });

    const error = thrownBy(() => {
      return config.bundle(new MemoryStore());
    });

    expect(error).toMatchObject({
      message: "A release carries at most one branding, but .zitadel/branding/ holds 2",
    });
  });

  it("does not count a broken file of another kind among the descriptors", () => {
    const config = aConfig({
      branding: { "one.json": aBranding() },
      schemas: { "broken.json": {} },
    });

    const bundle = () => {
      return config.bundle(new MemoryStore());
    };

    expect(bundle).not.toThrow(/at most one branding/);
  });

  it("refuses more than one branding descriptor", () => {
    const config = aConfig({
      branding: { "one.json": aBranding(), "two.json": aBranding() },
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

describe("ZitadelConfig.validate", () => {
  it("reports a field the connection contract does not have once", () => {
    const config = aConfig({
      connections: { "acme.json": anOidcConnection({ bogus: 1 }) },
    });

    const issues = config.validate().filter((issue) => {
      return issue.rule === "sso/unknown-connection-field";
    });

    expect(issues).toHaveLength(1);
  });
});

describe("ZitadelConfig.withOptions", () => {
  const customers = `${CONFIG_DIRECTORIES.schemas}/customers.json`;
  const published = new Map([[customers, ["sch_PUBLISHED"]]]);
  const deployed: ConfigDocuments = {
    schemas: { "customers.json": aUserSchema({ $id: "https://a.test/customers.json" }) },
    flows: { "login.json": aLoginFlow({ name: "login", userSchema: "sch_PUBLISHED" }) },
  };

  it("lets the rules see the schema a flow names by its published id", () => {
    const config = aConfig(deployed).withOptions({ published });

    const schemas = config.flows.all.map((flow) => {
      return config.flows.findSchemaOf(flow)?.path;
    });

    expect(schemas).toEqual([customers]);
  });

  it("leaves that flow with no schema when the options say nothing was published", () => {
    const config = aConfig(deployed, { published }).withOptions({});

    const schemas = config.flows.all.map((flow) => {
      return config.flows.findSchemaOf(flow)?.path;
    });

    expect(schemas).toEqual([undefined]);
  });

  it("keeps the documents and the broken files", () => {
    const config = aConfig({ ...deployed, ...SOUND_AND_BROKEN }).withOptions({ published });

    expect(config.broken).toMatchObject([{ path: BROKEN_SCHEMA }]);
  });
});

describe("ZitadelConfig.scaffold with a claim choice", () => {
  const choice = {
    mapping: { email: "email", employeeNumber: "employee_id" },
    verified: { email: "email_verified" },
    scopes: ["openid", "profile", "email"],
    created: [{ name: "employeeNumber", type: "string" }],
    notes: ["employee_id is not a standard claim."],
  };
  const withChoice = () => {
    return ZitadelConfig.empty().scaffold({
      ...MINIMAL,
      sso: [{ selection: { kind: "catalog", id: "google" }, claims: () => choice }],
    });
  };

  it("writes the mapping into the connection", () => {
    const { connections } = withChoice();

    expect(connections.map((entry) => entry.connection.body.claim_mapping)).toEqual([
      choice.mapping,
    ]);
  });

  it("adds the attributes it creates to the schema", () => {
    const { schema } = withChoice();

    expect(schema.propertyNames).toContain("employeeNumber");
  });

  it("asks for them on the register step of the flow", () => {
    const { flow } = withChoice();

    expect(flow.steps.find((step) => step.name === "register")?.fields).toContain("employeeNumber");
  });

  it("hands back what the choice has to say", () => {
    const { connections } = withChoice();

    expect(connections.flatMap((entry) => entry.notes)).toEqual(choice.notes);
  });

  it("keeps the provider's defaults for a provider with no choice", () => {
    const { connections } = ZitadelConfig.empty().scaffold({
      ...MINIMAL,
      sso: [{ selection: { kind: "catalog", id: "google" } }],
    });

    expect(connections.map((entry) => entry.created)).toEqual([[]]);
  });
});
