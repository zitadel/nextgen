/**
 * The authentication methods the CLI can scaffold for the MVP.
 * Backend support today is limited to password and identifier challenges;
 * passkey is accepted by the OAS spec via `x-credential: "passkey"` on a
 * user-schema property but is not yet executed by the Go flow engine.
 * Other spec-allowed values (`magic_link`, `sso`, `otp`) are deliberately
 * omitted until they have a defined step shape.
 */
export type AuthMethod = "password" | "passkey";

/**
 * Caller-supplied inputs to a flow builder. `fields` lists user-schema
 * property names to collect on the register step, in display order.
 * Treated as read-only by builders; mutation is a contract violation.
 */
export type BuildArgs = {
  readonly fields: ReadonlyArray<string>;
};
