import type { StepDefinition } from "./schema";

/**
 * Canonical URI for the human-user JSON Schema flow definitions reference
 * by default. The local schema body (`.zitadel/schemas/user.json`) is
 * derived from this same shape; the URI is the spec-required pointer
 * the platform stores against each flow.
 */
export const DEFAULT_USER_SCHEMA_URI =
  "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/human-user.yaml";

/**
 * Map a user-schema property name to the {@link StepDefinition.fields}
 * input type the renderer expects. Unknown names fall back to `text`
 * so unrecognized fields still render.
 */
export function fieldTypeFor(field: string): "text" | "email" | "password" | "tel" | "date" {
  if (field === "email") {
    return "email";
  }
  if (field === "phone") {
    return "tel";
  }
  if (field === "password") {
    return "password";
  }
  if (field === "date_of_birth" || field === "birthdate") {
    return "date";
  }
  return "text";
}

/**
 * English display labels for the known user-schema fields. Returns an
 * empty string for unknown names so the caller can decide whether to
 * inject a synthesized label or leave the entry blank for translators.
 */
export function fieldLabelFor(field: string): string {
  switch (field) {
    case "email": {
      return "Email address";
    }
    case "given_name": {
      return "First name";
    }
    case "family_name": {
      return "Last name";
    }
    case "phone": {
      return "Phone number";
    }
    case "date_of_birth":
    case "birthdate": {
      return "Date of birth";
    }
    default: {
      return "";
    }
  }
}

/**
 * The locale entries every method-built flow contributes regardless of
 * auth method. Method modules add credential-specific keys on top. The
 * dictionary is frozen at build time; callers must clone before mutating.
 */
export const BASE_LOCALE: Readonly<Record<string, string>> = Object.freeze({
  "identifier.title": "Sign in",
  "identifier.field.email": "Email address",
  "identifier.action.submit": "Continue",
  "identifier.action.register": "Create account",
  "credential.title": "Enter your credential",
  "credential.action.submit": "Sign in",
  "register_profile.title": "Create your account",
  "register_profile.action.submit": "Create account",
  "register_profile.action.login": "Already have an account? Sign in",
  "complete.title": "You're signed in",
});

/**
 * The identifier step: collects the email and offers a pivot to register.
 * Shared verbatim across all auth methods.
 */
export function identifierStep(): StepDefinition {
  return {
    name: "identifier",
    type: "identifier",
    texts: { title_key: "identifier.title" },
    fields: {
      email: {
        type: "email",
        text_key: "identifier.field.email",
        required: true,
      },
    },
    actions: {
      submit: { text_key: "identifier.action.submit", primary: true },
      register: { text_key: "identifier.action.register", primary: false },
    },
    gates: {},
    transitions: {
      submit: "credential",
      register: { pivot: "register" },
    },
  };
}

/**
 * The register-profile step: a form that collects the configured user
 * fields and offers a pivot back to login. Always uses
 * `register_profile.field.<name>` as the text_key so locale tooling can
 * stay consistent across methods.
 */
export function registerProfileStep(fields: ReadonlyArray<string>): StepDefinition {
  const registerFields: Record<string, StepDefinition["fields"][string]> = {};
  for (const field of fields) {
    registerFields[field] = {
      type: fieldTypeFor(field),
      text_key: `register_profile.field.${field}`,
      required: true,
    };
  }
  return {
    name: "register_profile",
    type: "form",
    texts: { title_key: "register_profile.title" },
    fields: registerFields,
    actions: {
      submit: { text_key: "register_profile.action.submit", primary: true },
      login: { text_key: "register_profile.action.login", primary: false },
    },
    gates: {},
    transitions: {
      submit: "complete",
      login: { pivot: "login" },
    },
  };
}

/**
 * The terminal step rendered after a successful sign-in or registration.
 * Has no fields, no actions, and no transitions — it is the leaf of
 * every flow purpose.
 */
export function completeStep(): StepDefinition {
  return {
    name: "complete",
    type: "complete",
    texts: { title_key: "complete.title" },
    fields: {},
    actions: {},
    gates: {},
  };
}

/**
 * Build the per-field entries the locale fragment contributes for the
 * register step. Skips entries already covered by {@link BASE_LOCALE}
 * (e.g. `register_profile.field.email` is not in BASE_LOCALE, but the
 * function still tolerates overlap defensively).
 */
export function registerFieldLocale(
  fields: ReadonlyArray<string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of fields) {
    const key = `register_profile.field.${field}`;
    if (!(key in BASE_LOCALE)) {
      out[key] = fieldLabelFor(field);
    }
  }
  return out;
}
