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
