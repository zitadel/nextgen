import { describe, expect, it } from "vitest";

import { mandatoryGatesMarkerComment, patchMandatoryGates } from "./mandatory-gates.js";
import type { FlowStep } from "./types.js";

const locale: Record<string, string> = {
  "identifier.field.email": "Email address",
  "submit.continue": "Continue",
};

const step: FlowStep = {
  name: "identifier",
  type: "identifier",
  fields: {
    email: { type: "email", text_key: "identifier.field.email", required: true },
  },
  actions: {
    submit: { text_key: "submit.continue", primary: true },
  },
};

describe("patchMandatoryGates", () => {
  it("appends a missing required field at the marker", () => {
    const html = `<div>${mandatoryGatesMarkerComment}</div>`;
    const out = patchMandatoryGates(html, step, locale);
    expect(out).not.toContain(mandatoryGatesMarkerComment);
    expect(out).toContain('<zl-field name="email"');
    expect(out).toContain('label="Email address"');
    expect(out).toContain("required");
  });

  it("appends a missing primary submit at the marker", () => {
    const html = `<zl-field name="email"></zl-field>${mandatoryGatesMarkerComment}`;
    const out = patchMandatoryGates(html, step, locale);
    expect(out).toContain('<zl-submit action="submit"');
    expect(out).toContain('label="Continue"');
  });

  it("appends a missing zl-error outlet", () => {
    const html = `<zl-field name="email"></zl-field><zl-submit action="submit"></zl-submit>${mandatoryGatesMarkerComment}`;
    const out = patchMandatoryGates(html, step, locale);
    expect(out).toContain("<zl-error></zl-error>");
  });

  it("does not add a zl-field when one already exists for the name", () => {
    const html = `<zl-field name="email"></zl-field><zl-submit action="submit"></zl-submit><zl-error></zl-error>${mandatoryGatesMarkerComment}`;
    const out = patchMandatoryGates(html, step, locale);
    const fieldMatches = out.match(/<zl-field/g) ?? [];
    expect(fieldMatches.length).toBe(1);
  });

  it("appends at end if the marker is missing entirely", () => {
    const html = `<zl-field name="email"></zl-field>`;
    const out = patchMandatoryGates(html, step, locale);
    expect(out.startsWith("<zl-field")).toBe(true);
    expect(out).toContain("<zl-submit");
    expect(out).toContain("<zl-error");
  });

  it("escapes attribute values in injected fields so the payload can't break out", () => {
    const malicious: FlowStep = {
      ...step,
      fields: {
        '"><script>': {
          type: "text",
          text_key: '"><script>alert(1)</script>',
          required: true,
        },
      },
    };
    const out = patchMandatoryGates(mandatoryGatesMarkerComment, malicious, locale);
    // The original payload must not appear verbatim — the browser serialiser
    // escapes the closing quote so the value stays trapped inside the
    // attribute. (The HTML spec only requires `&`, `"` and U+00A0 to be
    // escaped in attribute values, so `<` and `>` are emitted as-is; that's
    // safe because they're not significant inside attribute values.)
    expect(out).not.toContain('name=""');
    expect(out).toContain("&quot;");
    // Re-parsing the patched HTML must show the malicious markup is
    // encapsulated inside the `name` / `label` attributes, not as live tags.
    const parsed = new DOMParser().parseFromString(out, "text/html");
    expect(parsed.querySelector("script")).toBeNull();
    const field = parsed.querySelector("zl-field");
    expect(field).not.toBeNull();
    expect(field?.getAttribute("name")).toBe('"><script>');
  });
});
