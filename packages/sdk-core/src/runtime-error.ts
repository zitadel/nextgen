/**
 * The error thrown when the runtime cannot be resolved.
 *
 * The causes are a missing project id, a missing issuer in production, and an unknown environment
 * name. It fails startup loudly, so an app never runs unconfigured: an app without a project id
 * would otherwise treat every session as signed out and look broken for no visible reason.
 *
 * The same class reports a failed session read in the browser, so a caller branches on one error
 * type. The stable codes are:
 *
 * - `E_ZITADEL_CONFIG`: the runtime configuration is missing or invalid.
 * - `E_ZITADEL_SESSION_NO_BROWSER`: `getSession` ran on a server, where the cookie is not
 *   available.
 * - `E_ZITADEL_SESSION_READ_FAILED`: the proxy answered something other than a session or a
 *   signed-out answer.
 *
 * New codes may be added, so handle an unknown code with a default branch.
 *
 * @example
 * ```ts
 * try {
 *   resolveZitadelRuntimeEnv();
 * } catch (error) {
 *   if (error instanceof ZitadelRuntimeError) {
 *     console.error(error.code, error.message);
 *   }
 * }
 * ```
 */
export class ZitadelRuntimeError extends Error {
  /**
   * A stable machine-readable code.
   *
   * One of the codes listed on the class, so branch on it and not on the message.
   */
  readonly code: string;

  /**
   * Creates the error with its stable code.
   *
   * @param code - The stable error code.
   * @param message - What is wrong and which variable fixes it.
   */
  constructor(code: string, message: string) {
    super(message);
    this.name = "ZitadelRuntimeError";
    this.code = code;
  }
}
