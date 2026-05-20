/**
 * Minimal English locale dictionary.
 *
 * The `| t` filter looks up `text_key` strings here. Missing keys fall through
 * to the raw key (matches the spec in
 * `docs/design/flowengine/flow-engine-guide.md`).
 *
 * MVP only — multi-locale support is deferred.
 */
export const en: Record<string, string> = {
  // Step titles / descriptions
  "identifier.title": "Sign in",
  "identifier.description": "Enter your email to continue.",
  "password.title": "Welcome back, {0}",
  "password.description": "Enter your password to continue.",
  "complete.title": "You're signed in",
  // Field labels
  "identifier.field.email": "Email address",
  "identifier.field.username": "Username",
  "password.field.password": "Password",
  // Action labels
  "submit.continue": "Continue",
  "submit.signin": "Sign in",
  "submit.verify": "Verify",
  "action.register": "Create account",
  "action.forgot_password": "Forgot password?",
  "action.back": "Back",
  "action.passkey.signin": "Sign in with passkey",
  "action.passkey.register": "Register with passkey",
  // Register step
  "register.title": "Create your account",
  "register.description": "Fill in your details to get started.",
  "register.field.email": "Email address",
  "register.field.given_name": "First name",
  "register.field.family_name": "Last name",
  // Passkey ceremony
  "passkey.challenge.title": "Authenticating\u2026",
  "passkey.challenge.description": "Complete the passkey ceremony in your browser.",
  "passkey.enroll.title": "Register your passkey",
  "passkey.enroll.description": "Use your device to create a passkey for this account.",
  // Errors
  "error.invalid_credentials": "Those credentials don't match. Try again.",
  "error.required": "This field is required.",
};

export type Locale = Record<string, string>;
