import { buildPasskeyFlow, buildPasswordFlow } from "./methods";
import type { AuthMethod, FlowDefinition } from "./schema";

/**
 * Per-method builders, indexed by auth method. The `satisfies` clause
 * forces an exhaustive entry per {@link AuthMethod} so adding a new
 * member of the union without a builder fails to compile. Mirrors
 * `lib/user-schema`'s preset lookup in its `build.ts`.
 */
const BUILDERS = {
  password: buildPasswordFlow,
  passkey: buildPasskeyFlow,
} as const satisfies Readonly<
  Record<AuthMethod, (fields: ReadonlyArray<string>) => FlowDefinition>
>;

/**
 * Auth methods the CLI prompt offers, in display order (passkey
 * recommended). Frozen at build time; treat as read-only.
 */
export const AUTH_METHODS = ["passkey", "password"] as const satisfies ReadonlyArray<AuthMethod>;

/** Narrows an unknown value to a supported {@link AuthMethod}. */
export function isAuthMethod(value: unknown): value is AuthMethod {
  return typeof value === "string" && (AUTH_METHODS as ReadonlyArray<string>).includes(value);
}

/**
 * Build a flow_definition body for the chosen authentication method.
 * Pure: touches no filesystem or network. The returned object is newly
 * allocated; callers may retain references without risk of internal
 * mutation. The single entry point that constructs the resource,
 * paralleling `lib/user-schema`'s `buildUserSchema`.
 *
 * @param method - The auth method to scaffold. Must be a member of
 *   {@link AUTH_METHODS}; values outside this set are a type error.
 * @param fields - User-schema property names to collect on the register
 *   step, in display order.
 */
export function buildFlow(
  method: AuthMethod,
  fields: ReadonlyArray<string>,
): FlowDefinition {
  return BUILDERS[method](fields);
}
