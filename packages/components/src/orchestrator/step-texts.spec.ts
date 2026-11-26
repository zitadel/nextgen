import { describe, expect, it } from "vitest";

import { en as fullLocale } from "./locales/en.js";
import { localiseFlowErrorKeys } from "./step-texts.js";

describe("localiseFlowErrorKeys", () => {
  const ctx = { locale: fullLocale, stepName: "register" };

  it("passes catalog-known field-specific keys through as text keys, tagged with their field", () => {
    expect(localiseFlowErrorKeys("error.email_required", ctx)).toEqual([
      { field: "email", text_key: "error.email_required" },
    ]);
    // The server spells format violations `_invalid` — the catalog's
    // existing convention, which fieldErrorKeys routes inline.
    expect(localiseFlowErrorKeys("error.email_invalid", ctx)).toEqual([
      { field: "email", text_key: "error.email_invalid" },
    ]);
    expect(localiseFlowErrorKeys("error.password_required", ctx)).toEqual([
      { field: "password", text_key: "error.password_required" },
    ]);
  });

  it("falls back to a localised generic message with the step's field label", () => {
    // No `error.email_min_length` key exists; the label comes from
    // `register.field.email` when present, else the humanised name.
    const result = localiseFlowErrorKeys("error.email_min_length", {
      locale: { ...fullLocale, "register.field.email": "Work email" },
      stepName: "register",
    });
    expect(result).toEqual([{ message: "Work email is too short." }]);
  });

  it("humanises unknown field names (camelCase, snake_case, x-auth-methods#…)", () => {
    expect(localiseFlowErrorKeys("error.givenName_required", ctx)).toEqual([
      { message: "Given name is required." },
    ]);
    expect(localiseFlowErrorKeys("error.date_of_birth_invalid", ctx)).toEqual([
      { message: "Please enter a valid date of birth." },
    ]);
    expect(localiseFlowErrorKeys("error.x-auth-methods#password_min_length", ctx)).toEqual([
      { message: "Password is too short." },
    ]);
  });

  it("names the bound a length error's field carries", () => {
    const validations = { "x-auth-methods#password": { min_length: 12, max_length: 64 } };
    expect(
      localiseFlowErrorKeys("error.x-auth-methods#password_min_length", { ...ctx, validations }),
    ).toEqual([{ message: "Password must be at least 12 characters." }]);
    expect(
      localiseFlowErrorKeys("error.x-auth-methods#password_max_length", { ...ctx, validations }),
    ).toEqual([{ message: "Password must be at most 64 characters." }]);
  });

  it("keeps the generic length message when the field carries no such bound", () => {
    // A max_length bound does not name a min_length violation.
    const validations = { "x-auth-methods#password": { max_length: 64 } };
    expect(
      localiseFlowErrorKeys("error.x-auth-methods#password_min_length", { ...ctx, validations }),
    ).toEqual([{ message: "Password is too short." }]);
    expect(
      localiseFlowErrorKeys("error.x-auth-methods#password_min_length", {
        ...ctx,
        validations: {},
      }),
    ).toEqual([{ message: "Password is too short." }]);
  });

  it("covers every rule suffix's generic fallback, including unknown_field", () => {
    expect(localiseFlowErrorKeys("error.nickname_max_length", ctx)).toEqual([
      { message: "Nickname is too long." },
    ]);
    expect(localiseFlowErrorKeys("error.nickname_unknown_field", ctx)).toEqual([
      { message: "Please check nickname." },
    ]);
  });

  it("splits '; '-joined violations into one error per key", () => {
    const result = localiseFlowErrorKeys("error.email_invalid; error.password_min_length", {
      locale: { ...fullLocale, "register.field.password": "Password" },
      stepName: "register",
    });
    expect(result).toEqual([
      { field: "email", text_key: "error.email_invalid" },
      { message: "Password is too short." },
    ]);
  });

  it("passes non-validation error keys through for the template's key lookups", () => {
    // `error.sign_in_server` localises via its `.title`/`.body` sub-keys
    // in the alert filters; no rule suffix must not mean a lost error.
    expect(localiseFlowErrorKeys("error.sign_in_server", ctx)).toEqual([
      { text_key: "error.sign_in_server" },
    ]);
  });

  it("localises the engine's credential rejections via the catalog", () => {
    // SubmitPassword / SubmitPasskey rejections re-render the step with
    // these catalog keys (flow_state_machine.go) — invalid_credentials
    // routes inline to the password field via fieldErrorKeys; passkey_invalid
    // has no field mapping, so it stays a form-level (banner) text key.
    expect(localiseFlowErrorKeys("error.invalid_credentials", ctx)).toEqual([
      { field: "password", text_key: "error.invalid_credentials" },
    ]);
    expect(localiseFlowErrorKeys("error.passkey_invalid", ctx)).toEqual([
      { text_key: "error.passkey_invalid" },
    ]);
  });

  it("returns null for anything that is not an error.* key payload", () => {
    // Any other payload stays verbatim with the caller.
    expect(localiseFlowErrorKeys("not_a_key", ctx)).toBeNull();
    expect(localiseFlowErrorKeys("", ctx)).toBeNull();
    // A single non-key segment rejects the whole payload.
    expect(localiseFlowErrorKeys("error.email_required; not_a_key", ctx)).toBeNull();
  });

  it("survives a locale without the generic keys via the hardcoded fallback", () => {
    const result = localiseFlowErrorKeys("error.nickname_required", {
      locale: {},
      stepName: "register",
    });
    expect(result).toEqual([{ message: "Please check nickname." }]);
  });

  it("downgrades inline-routed keys to a banner message when the step lacks the field", () => {
    // fieldErrorKeys routes error.email_* inline to the email field, and
    // formLevelError suppresses their banner. On a step without an email
    // field the inline outlet doesn't exist — without the downgrade the
    // error would render nowhere.
    // The label resolves through the step's catalog entry
    // (`register.field.email` → "Email"), not the bare field name.
    expect(localiseFlowErrorKeys("error.email_required", { ...ctx, fields: ["password"] })).toEqual(
      [{ message: "Email is required." }],
    );
    // Inline key without a recognised rule suffix: its catalog copy
    // becomes the banner message verbatim.
    expect(localiseFlowErrorKeys("error.email_exists", { ...ctx, fields: ["password"] })).toEqual([
      { message: "An account with this email already exists." },
    ]);
  });

  it("keeps inline routing when the step carries the field", () => {
    expect(
      localiseFlowErrorKeys("error.email_required", { ...ctx, fields: ["email", "password"] }),
    ).toEqual([{ field: "email", text_key: "error.email_required" }]);
    // Without a fields list (pure lookups) the check is skipped entirely.
    expect(localiseFlowErrorKeys("error.email_required", ctx)).toEqual([
      { field: "email", text_key: "error.email_required" },
    ]);
  });

  it("routes the password credential errors onto a sign-in method's pointer field", () => {
    // The server keys the password field by its schema pointer, so a step
    // has `x-auth-methods#password`, never a plain `password`.
    for (const key of ["error.invalid_credentials", "error.password_required"]) {
      expect(localiseFlowErrorKeys(key, { ...ctx, fields: ["x-auth-methods#password"] })).toEqual([
        { field: "x-auth-methods#password", text_key: key },
      ]);
    }
  });

  it("routes a generic (non-catalog) field error inline when the step renders that field", () => {
    // `error.<field>_<rule>` for a schema field the step shows: the pre-localised
    // message is tagged with its field so the template renders it inline under
    // the control (the select/checkbox/text field) instead of the banner.
    expect(
      localiseFlowErrorKeys("error.country_required", {
        ...ctx,
        fields: ["email", "country"],
      }),
    ).toEqual([{ field: "country", message: "Country is required." }]);
    // A rule-suffixed key without a catalog entry, label from the step catalog.
    expect(
      localiseFlowErrorKeys("error.email_min_length", {
        locale: { ...fullLocale, "register.field.email": "Work email" },
        stepName: "register",
        fields: ["email"],
      }),
    ).toEqual([{ field: "email", message: "Work email is too short." }]);
    // The same key with the field absent stays a fieldless banner message.
    expect(localiseFlowErrorKeys("error.country_required", { ...ctx, fields: ["email"] })).toEqual([
      { message: "Country is required." },
    ]);
  });
});
