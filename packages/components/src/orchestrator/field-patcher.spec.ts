import type { CreateFlow201Step } from "@zitadel/api/generated/model";
import { describe, expect, it } from "vitest";

import { fieldPatcherMarkerComment, patchFields } from "./field-patcher.js";

const locale: Record<string, string> = {
  "identifier.field.email": "Work email",
  "submit.continue": "Continue",
};

const step: CreateFlow201Step = {
  name: "identifier",
  fields: [
    { name: "email", type: "email", text_key: "identifier.field.email", required: true },
  ],
  actions: [
    { name: "submit", text_key: "submit.continue", primary: true },
  ],
  gates: {},
};

describe("patchFields", () => {
  it("appends a missing required field at the marker", () => {
    const html = `<div>${fieldPatcherMarkerComment}</div>`;
    const out = patchFields(html, step, locale);
    expect(out).not.toContain(fieldPatcherMarkerComment);
    expect(out).toContain('<zl-field name="email"');
    expect(out).toContain('label="Work email"');
    expect(out).toContain("required");
  });

  it("appends a missing primary submit button at the marker", () => {
    const html = `<zl-field name="email"></zl-field>${fieldPatcherMarkerComment}`;
    const out = patchFields(html, step, locale);
    expect(out).toContain('<zl-button hierarchy="primary"');
    expect(out).toContain('type="submit"');
    expect(out).toContain('action="submit"');
    expect(out).toContain('label="Continue"');
  });

  it("does not duplicate a primary submit button when one already exists", () => {
    const html =
      `<zl-field name="email"></zl-field>` +
      `<zl-button hierarchy="primary" type="submit" action="submit"></zl-button>` +
      `${fieldPatcherMarkerComment}`;
    const out = patchFields(html, step, locale);
    const matches = out.match(/<zl-button[^>]*hierarchy="primary"/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("does not add a zl-field when one already exists for the name", () => {
    const html =
      `<zl-field name="email"></zl-field>` +
      `<zl-button hierarchy="primary" type="submit" action="submit"></zl-button>` +
      `${fieldPatcherMarkerComment}`;
    const out = patchFields(html, step, locale);
    const fieldMatches = out.match(/<zl-field/g) ?? [];
    expect(fieldMatches.length).toBe(1);
  });

  it("appends at end if the marker is missing entirely", () => {
    const html = `<zl-field name="email"></zl-field>`;
    const out = patchFields(html, step, locale);
    expect(out.startsWith("<zl-field")).toBe(true);
    expect(out).toContain('<zl-button hierarchy="primary"');
  });

  it("escapes attribute values in injected fields so the payload can't break out", () => {
    const malicious: CreateFlow201Step = {
      ...step,
      fields: [
        {
          name: '"><script>',
          type: "text",
          text_key: '"><script>alert(1)</script>',
          required: true,
        },
      ],
    };
    const out = patchFields(fieldPatcherMarkerComment, malicious, locale);
    // The original payload must not appear verbatim — the browser serialiser
    // escapes the closing quote so the value stays trapped inside the
    // attribute. (The HTML spec only requires `&`, `"` and U+00A0 to be
    // escaped in attribute values, so `<` and `>` are emitted as-is; that's
    // safe because they're not significant inside attribute values.)
    expect(out).not.toContain('name=""');
    expect(out).toContain("&quot;");
    const parsed = new DOMParser().parseFromString(out, "text/html");
    expect(parsed.querySelector("script")).toBeNull();
    const field = parsed.querySelector("zl-field");
    expect(field).not.toBeNull();
    expect(field?.getAttribute("name")).toBe('"><script>');
  });

  it("does not inject a field when a <zl-checkbox> with the same name exists", () => {
    const checkboxStep: CreateFlow201Step = {
      name: "register",
      fields: [
        { name: "terms", type: "checkbox", text_key: "register.field.terms", required: true },
      ],
      actions: [
        { name: "submit", text_key: "submit.continue", primary: true },
      ],
      gates: {},
    };
    const html =
      `<zl-checkbox name="terms"></zl-checkbox>` +
      `<zl-button hierarchy="primary" type="submit" action="submit"></zl-button>` +
      `${fieldPatcherMarkerComment}`;
    const out = patchFields(html, checkboxStep, locale);
    // Should not inject a duplicate zl-field for "terms"
    expect(out).not.toContain("<zl-field");
    const checkboxMatches = out.match(/<zl-checkbox/g) ?? [];
    expect(checkboxMatches.length).toBe(1);
  });

  it("does not inject a field when a <zl-select> with the same name exists", () => {
    const selectStep: CreateFlow201Step = {
      name: "register",
      fields: [
        { name: "language", type: "select", text_key: "register.field.lang", required: true },
      ],
      actions: [
        { name: "submit", text_key: "submit.continue", primary: true },
      ],
      gates: {},
    };
    const html =
      `<zl-select name="language"></zl-select>` +
      `<zl-button hierarchy="primary" type="submit" action="submit"></zl-button>` +
      `${fieldPatcherMarkerComment}`;
    const out = patchFields(html, selectStep, locale);
    // Should not inject a duplicate zl-field for "language"
    expect(out).not.toContain("<zl-field");
    const selectMatches = out.match(/<zl-select/g) ?? [];
    expect(selectMatches.length).toBe(1);
  });
});
