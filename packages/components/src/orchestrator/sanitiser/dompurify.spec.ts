import { describe, expect, it } from "vitest";

import { DomPurifySanitiser } from "./dompurify.js";

const sanitiser = await DomPurifySanitiser.load();

describe("DomPurifySanitiser", () => {
  it("preserves <zl-*> custom elements", () => {
    const out = sanitiser.sanitise(
      `<div><zl-field name="email" label="Email" type="email" required></zl-field></div>`,
    );
    expect(out).toContain("<zl-field");
    expect(out).toContain('name="email"');
    expect(out).toContain("required");
  });

  it.each(["name", "title", "id", "action", "method", "length", "location", "body", "domain"])(
    'keeps a field named "%s" that collides with a DOM property (#2532)',
    (value) => {
      const out = sanitiser.sanitise(`<zl-field name="${value}" label="x"></zl-field>`);
      expect(out).toContain(`name="${value}"`);
    },
  );

  it("preserves <zl-button> with hierarchy, action, and label", () => {
    const out = sanitiser.sanitise(
      `<zl-button hierarchy="primary" size="medium" type="submit" action="submit" label="Continue"></zl-button>`,
    );
    expect(out).toContain("<zl-button");
    expect(out).toContain('action="submit"');
    expect(out).toContain('hierarchy="primary"');
  });

  it("strips <script> tags", () => {
    const out = sanitiser.sanitise("<div>safe</div><script>alert(1)</script>");
    expect(out).not.toContain("<script");
    expect(out).toContain("safe");
  });

  it("strips inline event handlers", () => {
    const out = sanitiser.sanitise(`<img src="x" onerror="alert(1)" />`);
    expect(out).not.toContain("onerror");
  });

  it.each(["onmouseover", "onpointerdown", "onanimationend"])(
    "strips the %s handler from a custom element",
    (handler) => {
      const out = sanitiser.sanitise(
        `<zl-button ${handler}="alert(1)" action="submit">Go</zl-button>`,
      );
      expect(out).not.toContain(handler);
      expect(out).toContain('action="submit"');
    },
  );

  it("strips <style> blocks (theming is orchestrator-owned)", () => {
    const out = sanitiser.sanitise(`<div><style>:host { color: red }</style>safe</div>`);
    expect(out).not.toContain("<style");
  });

  it("strips <iframe>", () => {
    const out = sanitiser.sanitise(`<iframe src="https://evil.example.com"></iframe>`);
    expect(out).not.toContain("<iframe");
  });

  it("strips raw <input> / <button> / <form> (templates use zl-* atoms)", () => {
    const out = sanitiser.sanitise(`<form><input name="x" /><button>go</button></form>`);
    expect(out).not.toContain("<input");
    expect(out).not.toContain("<button");
    expect(out).not.toContain("<form");
  });

  it("preserves card nav links (data-action anchors, not zl-button)", () => {
    const out = sanitiser.sanitise(
      `<p class="zl-card-nav">Don't have an account? <a href="#" class="zl-card-nav__link" data-action="register">Sign up</a></p>`,
    );
    expect(out).toContain('class="zl-card-nav__link"');
    expect(out).toContain('data-action="register"');
    expect(out).not.toContain("<zl-button");
  });

  it("keeps the account chip and what the template tells it", () => {
    const out = sanitiser.sanitise(
      `<zl-account identifier="maya@example.com" action="back" label="Use another account" avatar=""></zl-account>`,
    );
    expect(out).toContain(
      '<zl-account identifier="maya@example.com" action="back" label="Use another account" avatar="">',
    );
  });

  it("keeps the account's avatar and its seed", () => {
    const out = sanitiser.sanitise(`<zl-avatar seed="maya@example.com"></zl-avatar>`);
    expect(out).toContain('<zl-avatar seed="maya@example.com">');
  });

  it("preserves data-* and aria-* attributes", () => {
    const out = sanitiser.sanitise(
      `<div data-theme="dark" data-testid="login" aria-label="Login">x</div>`,
    );
    expect(out).toContain('data-theme="dark"');
    expect(out).toContain('data-testid="login"');
    expect(out).toContain('aria-label="Login"');
  });

  it("preserves stable test ids on auth atoms", () => {
    const out = sanitiser.sanitise(
      `<zl-field name="email" data-testid="zitadel-field-email"></zl-field><zl-button action="submit" data-testid="zitadel-action-submit"></zl-button>`,
    );
    expect(out).toContain('data-testid="zitadel-field-email"');
    expect(out).toContain('data-testid="zitadel-action-submit"');
  });

  it("preserves <img> with safe src", () => {
    const out = sanitiser.sanitise(`<img src="https://cdn.example.com/logo.svg" alt="" />`);
    expect(out).toContain('src="https://cdn.example.com/logo.svg"');
  });

  it("strips unknown custom elements outside the zl-* namespace", () => {
    const out = sanitiser.sanitise(`<x-foo>evil</x-foo>`);
    expect(out).not.toContain("<x-foo");
  });
});
