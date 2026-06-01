import type { CreateFlowDefinitionBodyFlowDefinition } from "@zitadel-nextgen/api/generated/model";

import { buildPasskeyFlow, buildPasswordFlow } from "./methods";

/**
 * The authentication methods the CLI can scaffold for the MVP.
 * Backend support today is limited to password and identifier
 * challenges; passkey is accepted by the OAS spec via
 * `x-credential: "passkey"` on a user-schema property but is not yet
 * executed by the Go flow engine. Other spec-allowed values
 * (`magic_link`, `sso`, `otp`) are deliberately omitted until they
 * have a defined step shape.
 */
export type AuthMethod = "password" | "passkey";

/**
 * Per-method builders, indexed by auth method. The `satisfies` clause
 * forces an exhaustive entry per {@link AuthMethod} so adding a new
 * member of the union without a builder fails to compile.
 */
const BUILDERS = {
  password: buildPasswordFlow,
  passkey: buildPasskeyFlow,
} as const satisfies Readonly<
  Record<AuthMethod, (fields: ReadonlyArray<string>) => CreateFlowDefinitionBodyFlowDefinition>
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
 * mutation.
 *
 * @param method - The auth method to scaffold. Must be a member of
 *   {@link AUTH_METHODS}; values outside this set are a type error.
 * @param fields - User-schema property names to collect on the register
 *   step, in display order.
 */
export function buildFlow(
  method: AuthMethod,
  fields: ReadonlyArray<string>,
): CreateFlowDefinitionBodyFlowDefinition {
  return BUILDERS[method](fields);
}
