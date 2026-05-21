/**
 * Minimal English locale dictionary.
 *
 * The `| t` filter looks up `text_key` strings here. Missing keys fall through
 * to the raw key (matches the spec in
 * `docs/design/flowengine/flow-engine-guide.md`).
 *
 * Copy aligned to Figma screens file `xkvBjkOJ8ENuHdTGZHXezK` (May 2026).
 * MVP only — multi-locale support is deferred.
 */
export const en: Record<string, string> = {
  // --- Sign in (Figma 2xl `6593:141983`, card `6593:141985`, stack `6593:141989`) ---
  "identifier.title": "Sign in",
  "identifier.field.email": "Work email",
  "identifier.field.email.placeholder": "you@company.com",
  "identifier.field.password": "Password",
  "identifier.action.passkey": "Sign in with a passkey",
  "identifier.action.register.lead": "Don't have an account? ",
  "identifier.action.register.link": "Sign up",

  // --- Sign in / password step (same screen; split flow step 2) ---
  "password.title": "Sign in",
  "password.field.password": "Password",
  "password.action.passkey": "Sign in with a passkey",
  "password.action.register.lead": "Don't have an account? ",
  "password.action.register.link": "Sign up",

  // --- Sign up (2xl frame `6593:141741`, card `6593:141743`; see Figma dev annotations) ---
  "register.title": "Create your account",
  "register.field.email": "Work email",
  "register.field.email.placeholder": "you@company.com",
  "register.field.password": "Password",
  "register.field.password.help":
    "At least 8 characters, including a symbol and number.",
  "register.action.submit": "Sign up",
  "register.action.sign_in.lead": "Already have an account? ",
  "register.action.sign_in.link": "Sign in",

  // --- Passkey upsell (`6594:630`, heading `6594:89142`, body `6594:12796`) ---
  "passkey-upsell.title": "Sign in faster next time",
  "passkey-upsell.description.line1": "No password needed ever again.",
  "passkey-upsell.description.line2": "Sign in with Face ID, Touch ID, or PIN.",
  "passkey-upsell.action.setup": "Set up passkey",
  "passkey-upsell.action.skip": "Skip for now",
  /** Figma `6594:630` setup-passkey annotations — form-level `<zl-alert>`. */
  "error.passkey_cancelled": "Passkey setup was cancelled",
  "error.passkey_unsupported": "This device does not support passkeys",
  "error.passkey_failed": "Something went wrong. Please try again.",

  // --- Signed in (`6596:132846`) ---
  "complete.title": "You're signed in as",
  "signed-in.continue": "Continue",
  "signed-in.logout": "Logout",

  // --- Passkey login ---
  "passkey-login.title": "Sign in with your passkey",

  // --- Shared actions ---
  "submit.continue": "Continue",
  "submit.signin": "Sign in",
  "action.forgot_password": "Forgot password?",
  "action.cancel": "Cancel",

  // --- SSO ---
  "sso.redirect.title": "Redirecting to your provider…",

  // --- Field / form errors (Figma field annotations) ---
  "error.email_required": "Please enter an email address",
  "error.email_invalid": "Please enter a valid email",
  "error.password_required": "Please enter a password",
  "error.password_incorrect": "Wrong email or password.",
  "error.email_exists": "An account with this email already exists.",
  /** Figma sign-in error `6602:180268` — inline on password field. */
  "error.invalid_credentials": "Wrong email or password.",
  "error.required": "This field is required.",

  // --- Sign-in form-level alert (Figma `6594:125237`, alert `6596:132779`) ---
  "error.sign_in_server.title": "We couldn't complete your sign in.",
  "error.sign_in_server.body": "Please try again in a few minutes",
};

export type Locale = Record<string, string>;
