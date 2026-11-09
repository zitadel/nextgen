import { CustomOidcProvider, type CustomOidcInput, DEFAULT_SCOPES } from "@zitadel/config/idp";

import { isJsonObject, type JsonObject, UserSchema, type ZitadelConfig } from "@/lib/zitadel";
import { listAt } from "@/lib/zitadel/utils/json";
import {
  aFile,
  aLoginFlow,
  anOidcConnection,
  authMethods,
  aUserSchema,
  type ConfigDocuments,
  type ConnectionOverrides,
} from "@tests/helpers/config";
import { displayName, issuer, slug } from "@tests/helpers/idp-values";

/**
 * The `customers` user schema connections are written against: an `email`
 * property, signing in with the methods given.
 *
 * @param methods - The `x-auth-methods` block; a password by default.
 * @returns The schema document.
 */
export function aCustomersSchema(methods: JsonObject = authMethods("password")): JsonObject {
  return aUserSchema({
    objectType: "customers",
    properties: { email: { type: "string" } },
    "x-auth-methods": methods,
  });
}

/**
 * The `customers` schema as read from `.zitadel/schemas/customers.json`.
 */
export const CUSTOMERS_SCHEMA: UserSchema = UserSchema.of(
  aFile("schemas", "customers.json", aCustomersSchema()),
);

/**
 * A project holding the `customers` schema and the default login flow run
 * against it, at `.zitadel/flows/customers-login.json`.
 */
export const CUSTOMERS_PROJECT: ConfigDocuments = {
  schemas: { "customers.json": aCustomersSchema() },
  flows: { "customers-login.json": aLoginFlow({ userSchema: "customers" }) },
};

/**
 * A connection of the developer's own: `acme-sso`, reading both credentials
 * from the variables its slug derives.
 *
 * @param overrides - Top-level keys to set, and `oidc` keys to merge.
 * @returns The connection document.
 */
export function anAcmeSsoConnection(overrides: ConnectionOverrides = {}): JsonObject {
  const { oidc = {}, ...rest } = overrides;
  return anOidcConnection({
    slug: "acme-sso",
    display_name: "Acme SSO",
    ...rest,
    oidc: {
      client_id: "${{ ACME_SSO_CLIENT_ID }}",
      client_secret: "${{ ACME_SSO_CLIENT_SECRET }}",
      scopes: DEFAULT_SCOPES,
      ...oidc,
    },
  });
}

/**
 * The provider a developer describes for `acme-sso`, at
 * `https://sso.acme.example`.
 *
 * @param overrides - Settings to give in place of the defaults.
 * @returns The provider.
 */
export function anAcmeSsoProvider(overrides: Partial<CustomOidcInput> = {}): CustomOidcProvider {
  return new CustomOidcProvider({
    slug: slug("acme-sso"),
    displayName: displayName("Acme SSO"),
    issuer: issuer("https://sso.acme.example"),
    scopes: DEFAULT_SCOPES,
    ...overrides,
  });
}

/**
 * The body of the one flow a configuration holds, such as the flow an edit
 * generated.
 *
 * @param config - The configuration.
 * @returns The flow document.
 * @throws {@link Error} When the configuration holds no flow or several.
 */
export function onlyFlowOf(config: ZitadelConfig): JsonObject {
  const [flow, ...others] = config.flows.all;
  if (flow === undefined || others.length > 0) {
    throw new Error("The configuration does not hold exactly one flow");
  }
  return flow.body;
}

/**
 * A flow document with keys of one step set, as a developer editing the file
 * by hand would.
 *
 * @param flow - The flow document.
 * @param name - The step's name.
 * @param changes - The keys to set on that step.
 * @returns The flow document, with every other step as it was.
 */
export function withStepChanged(flow: JsonObject, name: string, changes: JsonObject): JsonObject {
  const steps = listAt(flow, "steps");
  return {
    ...flow,
    steps: steps.map((step) => {
      if (isJsonObject(step) && step.name === name) {
        return { ...step, ...changes };
      }
      return step;
    }),
  };
}
