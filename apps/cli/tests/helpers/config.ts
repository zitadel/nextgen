import { dirname, join } from "node:path";

import defaultLogin from "@zitadel/config/defaults/default-login.json" with { type: "json" };

import {
  CONFIG_DIRECTORIES,
  type ConfigFile,
  type ConfigKind,
  type ConfigOptions,
  isJsonObject,
  isJsonValue,
  type JsonObject,
  type PolicyOperation,
  ZitadelConfig,
} from "@/lib/zitadel";
import { MemoryStore } from "@tests/helpers/storage/backend/memory";

/**
 * The documents of one kind, by file name under that kind's directory.
 */
export type DocumentsByName = Readonly<Record<string, JsonObject>>;

/**
 * A configuration as a test states it: the documents of each kind it holds, by
 * file name. A kind left out holds no documents.
 */
export type ConfigDocuments = Partial<Readonly<Record<ConfigKind, DocumentsByName>>>;

/**
 * One configuration file as a store reads it, at `.zitadel/<directory>/<name>`,
 * for a test of a single document (`Flow.of(aFile("flows", "login.json", body))`).
 *
 * @param kind - The kind of document.
 * @param name - The file's name under that kind's directory.
 * @param body - The document.
 * @returns The file.
 */
export function aFile(kind: ConfigKind, name: string, body: JsonObject): ConfigFile {
  return { path: `${CONFIG_DIRECTORIES[kind]}/${name}`, body };
}

/**
 * An `x-auth-methods` block enabling each of `methods`.
 *
 * @param methods - The methods to enable, such as `password` or `passkey`.
 * @returns The block.
 */
export function authMethods(...methods: string[]): JsonObject {
  return Object.fromEntries(
    methods.map((method) => {
      return [method, { enabled: true }];
    }),
  );
}

/**
 * The files a configuration holds, each at `.zitadel/<directory>/<name>`.
 *
 * @param documents - The documents of each kind, by file name.
 * @returns The files, by kind, in the order the documents name them.
 */
export function configFiles(documents: ConfigDocuments = {}): {
  readonly [K in ConfigKind]: readonly ConfigFile[];
} {
  return {
    schemas: filesOf(documents, "schemas"),
    flows: filesOf(documents, "flows"),
    connections: filesOf(documents, "connections"),
    policies: filesOf(documents, "policies"),
    branding: filesOf(documents, "branding"),
  };
}

/**
 * The files of one kind, each at `.zitadel/<directory>/<name>`.
 *
 * @param documents - The documents of each kind, by file name.
 * @param kind - The kind to take.
 * @returns The files, in the order the documents name them.
 */
function filesOf(documents: ConfigDocuments, kind: ConfigKind): ConfigFile[] {
  return Object.entries(documents[kind] ?? {}).map(([name, body]) => {
    return { path: `${CONFIG_DIRECTORIES[kind]}/${name}`, body };
  });
}

/**
 * A configuration holding the documents the documents name, taken as written.
 *
 * @param documents - The documents of each kind, by file name.
 * @param options - What is known beyond the files.
 * @returns The configuration.
 */
export function aConfig(
  documents: ConfigDocuments = {},
  options: ConfigOptions = {},
): ZitadelConfig {
  return ZitadelConfig.of(configFiles(documents), options);
}

/**
 * A store holding the documents the documents name, and the other files a `$file`
 * reference may name.
 *
 * @param documents - The documents of each kind, by file name.
 * @param assets - Other files, by project-relative path.
 * @returns The store.
 */
export function aStore(
  documents: ConfigDocuments = {},
  assets: Readonly<Record<string, string>> = {},
): MemoryStore {
  const files = Object.values(configFiles(documents)).flat();
  return aStoreHolding(files, assets);
}

/**
 * A store holding the files given, written into its in-memory filesystem the
 * way they would be on disk.
 *
 * @param files - The configuration files, by path and body.
 * @param texts - Other files, by project-relative path, as text: one a `$file`
 *   reference names, or a configuration file as it would be on disk, such as
 *   one that is not valid JSON.
 * @returns The store.
 */
export function aStoreHolding(
  files: readonly ConfigFile[] = [],
  texts: Readonly<Record<string, string>> = {},
): MemoryStore {
  const store = new MemoryStore();
  const held = [
    ...files.map((file) => {
      return [file.path, MemoryStore.render(file.body)] as const;
    }),
    ...Object.entries(texts),
  ];
  for (const [path, text] of held) {
    const target = join(MemoryStore.ROOT, path);
    store.volume.mkdirSync(dirname(target), { recursive: true });
    store.volume.writeFileSync(target, text);
  }
  return store;
}

/**
 * The body a store holds at a path, for a test to assert on.
 *
 * @param store - The store.
 * @param path - The project-relative path.
 * @returns The body, or `undefined` when nothing is there or the file there is
 *   not a JSON object.
 */
export function bodyAt(store: MemoryStore, path: string): JsonObject | undefined {
  try {
    const body: unknown = JSON.parse(
      store.volume.readFileSync(join(MemoryStore.ROOT, path), "utf8").toString(),
    );
    return isJsonValue(body) && isJsonObject(body) ? body : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A user schema the server accepts: `human-user`, signing in by email with a
 * password.
 *
 * @param overrides - Top-level keys to set in place of the defaults.
 * @returns The schema document.
 */
export function aUserSchema(overrides: JsonObject = {}): JsonObject {
  return {
    objectType: "human-user",
    kind: "user-schema",
    metaSchema: "https://example.com/meta/user-schema.json",
    "x-auth-methods": { password: { enabled: true } },
    "x-identifier": "email",
    properties: { email: { "x-unique": "project" } },
    ...overrides,
  };
}

/**
 * What a test changes of an OIDC connection: top-level keys, and keys of its
 * `oidc` block, which are merged into the default block rather than replacing it.
 */
export type ConnectionOverrides = JsonObject & Readonly<{ oidc?: JsonObject }>;

/**
 * An OIDC connection the server accepts: `acme`, whose client secret is the
 * `${{ ACME_CLIENT_SECRET }}` variable.
 *
 * @param overrides - Top-level keys to set, and `oidc` keys to merge.
 * @returns The connection document.
 */
export function anOidcConnection(overrides: ConnectionOverrides = {}): JsonObject {
  const { oidc = {}, ...rest } = overrides;
  return {
    slug: "acme",
    protocol: "oidc",
    display_name: "Acme",
    ...rest,
    oidc: {
      issuer: "https://sso.acme.example",
      client_id: "client",
      client_secret: "${{ ACME_CLIENT_SECRET }}",
      scopes: ["openid"],
      ...oidc,
    },
  };
}

/**
 * The catalog Google connection the CLI writes: `google`, whose client secret
 * is the `${{ GOOGLE_CLIENT_SECRET }}` variable.
 *
 * @param overrides - Top-level keys to set, and `oidc` keys to merge.
 * @returns The connection document.
 */
export function aGoogleConnection(overrides: ConnectionOverrides = {}): JsonObject {
  const { oidc = {}, ...rest } = overrides;
  return anOidcConnection({
    slug: "google",
    template: "google",
    display_name: "Google",
    ...rest,
    oidc: {
      issuer: "https://accounts.google.com",
      client_id: "111.apps.googleusercontent.com",
      client_secret: "${{ GOOGLE_CLIENT_SECRET }}",
      ...oidc,
    },
  });
}

/**
 * A branding descriptor the server accepts, whose template is inline and
 * renders the mandatory gates.
 *
 * @param overrides - Keys to set in place of the defaults.
 * @returns The branding document.
 */
export function aBranding(overrides: JsonObject = {}): JsonObject {
  return {
    layout: "centered",
    liquid_template: "<zl-page-shell>{% mandatory_gates %}</zl-page-shell>",
    ...overrides,
  };
}

/**
 * What a test changes of the default login flow.
 */
export type LoginFlowOptions = Readonly<{
  /**
   * The flow's name.
   */
  name?: string;
  /**
   * The schema the flow signs users of in, by object type or revision id.
   */
  userSchema?: string;
  /**
   * The fields its identifier step collects.
   */
  collects?: readonly string[];
}>;

/**
 * The default login flow the CLI scaffolds: an identifier step collecting the
 * email, then a password.
 *
 * @param options - The name, the schema and the identifier step's fields to set.
 * @returns The flow document.
 */
export function aLoginFlow(options: LoginFlowOptions = {}): JsonObject {
  const { name = defaultLogin.name, userSchema = defaultLogin.user_schema, collects } = options;
  return {
    ...defaultLogin,
    name,
    user_schema: userSchema,
    steps: defaultLogin.steps.map((step) => {
      if (step.name === "identifier" && collects !== undefined) {
        return { ...step, fields: collects };
      }
      return step;
    }),
  };
}

/**
 * The operation the policy builders are for.
 */
export const PASSWORD_POLICY: PolicyOperation = "auth.factor.password.set";

/**
 * A password policy the server accepts, requiring twelve characters.
 *
 * @param config - Settings to set in place of the defaults.
 * @returns The policy document.
 */
export function aPasswordPolicy(config: JsonObject = { min_length: 12 }): JsonObject {
  return { operation: PASSWORD_POLICY, config };
}
