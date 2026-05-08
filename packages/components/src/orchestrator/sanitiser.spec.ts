import { describe, expect, it } from "vitest";

import { createSanitiser } from "./sanitiser.js";

describe("DOMPurify sanitiser", () => {
  const sanitise = createSanitiser();

  it("preserves <zl-*> custom elements", () => {
    const out = sanitise(
      `<div><zl-field name="email" label="Email" type="email" required></zl-field></div>`,
    );
    expect(out).toContain("<zl-field");
    expect(out).toContain('name="email"');
    expect(out).toContain("required");
  });

  it("preserves <zl-submit> with action and label", () => {
    const out = sanitise(`<zl-submit action="submit" label="Continue"></zl-submit>`);
    expect(out).toContain("<zl-submit");
    expect(out).toContain('action="submit"');
  });

  it("strips <script> tags", () => {
    const out = sanitise("<div>safe</div><script>alert(1)</script>");
    expect(out).not.toContain("<script");
    expect(out).toContain("safe");
  });

  it("strips inline event handlers", () => {
    const out = sanitise(`<img src="x" onerror="alert(1)" />`);
    expect(out).not.toContain("onerror");
  });

  it("strips <style> blocks (theming is orchestrator-owned)", () => {
    const out = sanitise(`<div><style>:host { color: red }</style>safe</div>`);
    expect(out).not.toContain("<style");
  });

  it("strips <iframe>", () => {
    const out = sanitise(`<iframe src="https://evil.example.com"></iframe>`);
    expect(out).not.toContain("<iframe");
  });

  it("strips raw <input> / <button> / <form> (templates use zl-* atoms)", () => {
    const out = sanitise(`<form><input name="x" /><button>go</button></form>`);
    expect(out).not.toContain("<input");
    expect(out).not.toContain("<button");
    expect(out).not.toContain("<form");
  });

  it("preserves data-* and aria-* attributes", () => {
    const out = sanitise(`<div data-theme="dark" aria-label="Login">x</div>`);
    expect(out).toContain('data-theme="dark"');
    expect(out).toContain('aria-label="Login"');
  });

  it("preserves <img> with safe src", () => {
    const out = sanitise(`<img src="https://cdn.example.com/logo.svg" alt="" />`);
    expect(out).toContain('src="https://cdn.example.com/logo.svg"');
  });

  it("strips unknown custom elements outside the zl-* namespace", () => {
    const out = sanitise(`<x-foo>evil</x-foo>`);
    expect(out).not.toContain("<x-foo");
  });
});
