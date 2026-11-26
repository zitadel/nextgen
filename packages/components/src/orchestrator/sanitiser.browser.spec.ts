import { describe, expect, it } from "vitest";

import { createSanitiser } from "./sanitiser.js";

const sanitiser = await createSanitiser();

describe("createSanitiser with the browser's Sanitizer API", () => {
  it("runs on a browser that has setHTML()", () => {
    expect("setHTML" in Element.prototype).toBe(true);
  });

  it("keeps <zl-*> elements with their attributes and text", () => {
    const out = sanitiser.sanitise(
      `<zl-page-shell data-zl-template-root><h1 class="zl-card-title">Sign in</h1><zl-field name="email" label="Email" type="email" required></zl-field></zl-page-shell>`,
    );

    expect(out).toBe(
      `<zl-page-shell data-zl-template-root=""><h1 class="zl-card-title">Sign in</h1><zl-field name="email" label="Email" type="email" required=""></zl-field></zl-page-shell>`,
    );
  });

  it("keeps the test id on an atom", () => {
    const out = sanitiser.sanitise(
      `<zl-button action="submit" data-testid="zitadel-action-submit"></zl-button>`,
    );

    expect(out).toBe(`<zl-button action="submit" data-testid="zitadel-action-submit"></zl-button>`);
  });

  it("keeps data-* and aria-* attributes", () => {
    const out = sanitiser.sanitise(
      `<div data-theme="dark" data-testid="login" aria-label="Login">x</div>`,
    );

    expect(out).toBe(`<div data-theme="dark" data-testid="login" aria-label="Login">x</div>`);
  });

  it("strips scripts, event handlers and javascript: links", () => {
    const out = sanitiser.sanitise(
      `<div>safe</div><script>alert(1)</script><img src="x" onerror="alert(1)"><a href="javascript:alert(1)" data-action="recover">Reset</a>`,
    );

    expect(out).toBe(`<div>safe</div><img src="x"><a data-action="recover">Reset</a>`);
  });

  it("strips elements outside the allowlist", () => {
    const out = sanitiser.sanitise(
      `<x-foo>evil</x-foo><iframe src="https://evil.example.com"></iframe><p>ok</p>`,
    );

    expect(out).toBe(`<p>ok</p>`);
  });
});
