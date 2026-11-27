import { setApiAuthToken } from "./auth";
import { setProxyPath } from "./base-url";
import { type RequestPolicy, setRequestPolicy } from "./fetch";

/**
 * What one client's calls run with: where they go, the bearer they carry and
 * the policy that binds them.
 */
export type CallSettings = Readonly<{
  /** The proxy path or server URL the call goes to. */
  baseUrl: string;
  /** The bearer sent with the call, or `undefined` for none. */
  token: string | undefined;
  /** The signal, deadline and user agent the call runs under; `{}` for none. */
  policy: RequestPolicy;
}>;

/**
 * Calls a generated operation with one client's settings.
 *
 * The generated operations read the base URL, the bearer and the request policy
 * from slots the whole page shares, so a caller must write all three right
 * before each call, or the call runs with whatever the last client left there:
 * another client's abort signal, deadline or user agent. This is the one place
 * that writes them; `createZitadelClient` and the `<zitadel-login>` widget both
 * call through it. The operations read the slots before their first `await`,
 * so no other client can run in between.
 *
 * @param settings - The calling client's base URL, bearer and policy.
 * @param operation - The generated operation to call.
 * @param args - The operation's arguments.
 * @returns What the operation returns.
 *
 * @example
 * ```ts
 * import { getMySession } from "@zitadel/api/generated/endpoints/zitadelNextGen";
 * import { callWith } from "@zitadel/api/runtime/call";
 *
 * const session = await callWith(
 *   { baseUrl: "/__nextgen", token: undefined, policy: {} },
 *   getMySession,
 * );
 * ```
 */
export function callWith<A extends unknown[], R>(
  settings: CallSettings,
  operation: (...args: A) => R,
  ...args: A
): R {
  setProxyPath(settings.baseUrl);
  setApiAuthToken(settings.token);
  setRequestPolicy(settings.policy);
  return operation(...args);
}
