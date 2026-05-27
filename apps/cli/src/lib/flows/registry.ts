import type { FlowFragment, FlowMethod } from "./method";
import { passkey } from "./passkey";
import { password } from "./password";
import type { AuthMethod, BuildArgs } from "./types";

/**
 * The registry of auth methods the CLI can scaffold. Keys must be
 * members of {@link AuthMethod}; values are the matching
 * {@link FlowMethod} implementations. The `satisfies` clause forces
 * an exhaustive entry per `AuthMethod` and protects against drift if
 * the union grows.
 */
const REGISTRY = { password, passkey } as const satisfies Readonly<Record<AuthMethod, FlowMethod>>;

/**
 * The auth methods the CLI prompt offers, in display order (passkey
 * recommended). Frozen at build time; treat as read-only.
 */
export const AUTH_METHODS = ["passkey", "password"] as const satisfies ReadonlyArray<AuthMethod>;

/**
 * Build a complete flow definition and its locale fragment for the
 * chosen authentication method. Dispatches to the matching entry in
 * {@link REGISTRY}. Pure: touches no filesystem or network. The
 * returned objects are newly allocated; callers may retain references
 * without risk of internal mutation.
 *
 * @param method - The auth method to scaffold. Must be a member of
 *   {@link AUTH_METHODS}; values outside this set are a type error.
 * @param args - Caller-supplied inputs. `fields` lists user-schema
 *   property names the register step collects, in display order.
 */
export function buildFlowAndLocale(
  method: AuthMethod,
  args: Readonly<BuildArgs>,
): FlowFragment {
  return REGISTRY[method].build(args);
}
