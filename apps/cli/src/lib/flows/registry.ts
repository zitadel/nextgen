import { buildPasskeyFlow } from "./passkey";
import { buildPasswordFlow } from "./password";
import type { FlowDefinition } from "./schema";
import type { AuthMethod } from "./types";

/**
 * Per-method builders, indexed by auth method. The `satisfies` clause
 * forces an exhaustive entry per {@link AuthMethod} so adding a new
 * member of the union without a builder fails to compile.
 */
const BUILDERS = {
  password: buildPasswordFlow,
  passkey: buildPasskeyFlow,
} as const satisfies Readonly<
  Record<
    AuthMethod,
    (fields: ReadonlyArray<string>) => {
      flow: FlowDefinition;
      locale: Record<string, string>;
    }
  >
>;

/**
 * Auth methods the CLI prompt offers, in display order (passkey
 * recommended). Frozen at build time; treat as read-only.
 */
export const AUTH_METHODS = ["passkey", "password"] as const satisfies ReadonlyArray<AuthMethod>;

/**
 * Build a flow_definition body and its English locale seed for the
 * chosen authentication method. Pure: touches no filesystem or
 * network. The returned objects are newly allocated; callers may
 * retain references without risk of internal mutation.
 *
 * @param method - The auth method to scaffold. Must be a member of
 *   {@link AUTH_METHODS}; values outside this set are a type error.
 * @param fields - User-schema property names to collect on the
 *   register step, in display order.
 */
export function buildFlowAndLocale(
  method: AuthMethod,
  fields: ReadonlyArray<string>,
): { flow: FlowDefinition; locale: Record<string, string> } {
  return BUILDERS[method](fields);
}
