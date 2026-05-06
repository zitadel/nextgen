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
  "action.register": "Create account",
  "action.forgot_password": "Forgot password?",
  "action.back": "Back",
  // Errors
  "error.invalid_credentials": "Those credentials don't match. Try again.",
  "error.required": "This field is required.",
};

export type Locale = Record<string, string>;
