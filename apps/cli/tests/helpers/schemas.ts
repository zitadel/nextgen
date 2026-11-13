import type { JsonObject, UserSchema, ZitadelConfig } from "@/lib/zitadel";
import { Flow } from "@/lib/zitadel/resources/flows/flow";
import type { SchemaEdit, ToggleableMethod } from "@/lib/zitadel/resources/schemas/types";
import { aUserSchema } from "@tests/helpers/config";

/**
 * The `objectType` of the schema {@link aUserSchema} builds, which a flow's
 * `user_schema` names it by.
 */
export const HUMAN_USER = "human-user";

/**
 * The user schema {@link aUserSchema} builds, without one of its keys.
 *
 * @param key - The key to leave out, such as `x-identifier`.
 * @param overrides - Top-level keys to set in place of the defaults.
 * @returns The schema document.
 */
export function aUserSchemaWithout(key: string, overrides: JsonObject = {}): JsonObject {
  return Object.fromEntries(
    Object.entries(aUserSchema(overrides)).filter(([name]) => {
      return name !== key;
    }),
  );
}

/**
 * A user schema whose only sign-in method is SSO through `providers`.
 *
 * @param providers - What `x-auth-methods.sso.providers` lists.
 * @param overrides - Top-level keys to set in place of the defaults.
 * @returns The schema document.
 */
export function aSchemaListing(
  providers: readonly string[],
  overrides: JsonObject = {},
): JsonObject {
  return aUserSchema({
    "x-auth-methods": { sso: { enabled: true, providers: [...providers] } },
    ...overrides,
  });
}

/**
 * A login flow whose entry step offers SSO through `providers`, and
 * routes each outcome of signing in that way.
 *
 * @param providers - The providers its entry step offers.
 * @param userSchema - What its `user_schema` names; {@link HUMAN_USER} by default.
 * @returns The flow document.
 */
export function aFlowOffering(
  providers: readonly string[],
  userSchema: string = HUMAN_USER,
): JsonObject {
  return {
    name: "sso-login",
    user_schema: userSchema,
    purposes: { login: "identifier" },
    steps: [
      {
        name: "identifier",
        sso_providers: [...providers],
        transitions: {
          sso_authenticated: { target: "done" },
          sso_user_not_found: { target: "register-sso" },
          user_already_exists: { target: "sso-conflict" },
        },
      },
    ],
  };
}

/**
 * The edit that replaces a configuration's only schema with what `change`
 * makes of it.
 *
 * @param config - The configuration, holding one schema.
 * @param change - What to make of the schema.
 * @returns The edit.
 */
export function aSchemaEdit(
  config: ZitadelConfig,
  change: (schema: UserSchema) => UserSchema,
): SchemaEdit {
  const original = config.schemas.resolve();
  const edited = change(original);
  return { before: config, after: config.with(edited), original, edited };
}

/**
 * The edit that switches a method of a configuration's only schema on or off.
 *
 * @param config - The configuration, holding one schema.
 * @param method - The method.
 * @param enabled - Whether the edit switches it on.
 * @returns The edit.
 */
export function aMethodEdit(
  config: ZitadelConfig,
  method: ToggleableMethod,
  enabled: boolean,
): SchemaEdit {
  return aSchemaEdit(config, (schema) => {
    if (enabled) {
      return schema.withMethod(method).document;
    }
    return schema.withoutMethod(method).document;
  });
}

/**
 * The edit that switches a method of a configuration's only schema on or off
 * while it also replaces the body of a flow, as one change.
 *
 * @param config - The configuration, holding one schema.
 * @param method - The method.
 * @param enabled - Whether the edit switches it on.
 * @param flow - The flow's path and the body the change writes there.
 * @param flow.path - Where the flow sits.
 * @param flow.body - The body the change writes.
 * @returns The edit.
 */
export function aMethodEditRewritingFlow(
  config: ZitadelConfig,
  method: ToggleableMethod,
  enabled: boolean,
  flow: { readonly path: string; readonly body: JsonObject },
): SchemaEdit {
  const methodEdit = aMethodEdit(config, method, enabled);
  const after = config
    .with(Flow.create({ path: flow.path, body: flow.body }))
    .with(methodEdit.edited);
  return { ...methodEdit, after };
}
