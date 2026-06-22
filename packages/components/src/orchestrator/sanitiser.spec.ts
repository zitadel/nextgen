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

  it("preserves <zl-button> with hierarchy, action, and label", () => {
    const out = sanitise(
      `<zl-button hierarchy="primary" size="medium" type="submit" action="submit" label="Continue"></zl-button>`,
    );
    expect(out).toContain("<zl-button");
    expect(out).toContain('action="submit"');
    expect(out).toContain('hierarchy="primary"');
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

  it("preserves card nav links (data-action anchors, not zl-button)", () => {
    const out = sanitise(
      `<p class="zl-card-nav">Don't have an account? <a href="#" class="zl-card-nav__link" data-action="register">Sign up</a></p>`,
    );
    expect(out).toContain('class="zl-card-nav__link"');
    expect(out).toContain('data-action="register"');
    expect(out).not.toContain("<zl-button");
  });

  it("preserves data-* and aria-* attributes", () => {
    const out = sanitise(`<div data-theme="dark" data-testid="login" aria-label="Login">x</div>`);
    expect(out).toContain('data-theme="dark"');
    expect(out).toContain('data-testid="login"');
    expect(out).toContain('aria-label="Login"');
  });

  it("preserves stable test ids on auth atoms", () => {
    const out = sanitise(
      `<zl-field name="email" data-testid="zitadel-field-email"></zl-field><zl-button action="submit" data-testid="zitadel-action-submit"></zl-button>`,
    );
    expect(out).toContain('data-testid="zitadel-field-email"');
    expect(out).toContain('data-testid="zitadel-action-submit"');
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
