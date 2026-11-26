import { describe, expect, it } from "vitest";

import { DomPurifySanitiser } from "./dompurify.js";
import { NativeSanitiser } from "./native.js";

const supported = NativeSanitiser.isSupported();
const purify = await DomPurifySanitiser.load();

/**
 * Template markup and what both sanitisers make of it, exactly: the native one
 * and DOMPurify, which Safari loads.
 */
const cases: ReadonlyArray<[string, string, string]> = [
  [
    "keeps atoms with their attributes and text",
    `<zl-page-shell data-zl-template-root><h1 class="zl-card-title">Sign in</h1><zl-field name="email" label="Email" type="email" required></zl-field></zl-page-shell>`,
    `<zl-page-shell data-zl-template-root=""><h1 class="zl-card-title">Sign in</h1><zl-field name="email" label="Email" type="email" required=""></zl-field></zl-page-shell>`,
  ],
  [
    "keeps the test id on an atom",
    `<zl-button action="submit" data-testid="zitadel-action-submit"></zl-button>`,
    `<zl-button action="submit" data-testid="zitadel-action-submit"></zl-button>`,
  ],
  [
    "keeps data-* and aria-* attributes",
    `<div data-theme="dark" data-testid="login" aria-label="Login" aria-live="polite">x</div>`,
    `<div data-theme="dark" data-testid="login" aria-label="Login" aria-live="polite">x</div>`,
  ],
  [
    "keeps inline formatting and its text",
    `<p><b>Note:</b> use your <i>work</i> email, <code>name@example.com</code></p>`,
    `<p><b>Note:</b> use your <i>work</i> email, <code>name@example.com</code></p>`,
  ],
  [
    "keeps the attributes a list and a link have by default",
    `<ol start="3" reversed><li value="2">x</li></ol><a href="/f" hreflang="de">a</a>`,
    `<ol start="3" reversed=""><li value="2">x</li></ol><a href="/f" hreflang="de">a</a>`,
  ],
  [
    "keeps a table",
    `<table><tr><td colspan="2">Cell</td></tr></table>`,
    `<table><tbody><tr><td colspan="2">Cell</td></tr></tbody></table>`,
  ],
  [
    "keeps an image with its size",
    `<img src="https://cdn.example.com/logo.svg" width="120" height="40" alt="" loading="lazy">`,
    `<img src="https://cdn.example.com/logo.svg" width="120" height="40" alt="" loading="lazy">`,
  ],
  [
    "keeps the text of a raw button or form, not the controls",
    `<button>Continue</button><form><input name="i">Fields</form>`,
    `ContinueFields`,
  ],
  [
    "strips scripts, styles, frames and their content",
    `<div>safe</div><script>alert(1)</script><style>:host{}</style><iframe src="https://evil.example.com">x</iframe>`,
    `<div>safe</div>`,
  ],
  [
    "strips event handlers and javascript: links",
    `<img src="x" onerror="alert(1)"><a href="javascript:alert(1)" data-action="recover">Reset</a>`,
    `<img src="x"><a data-action="recover">Reset</a>`,
  ],
  [
    "drops an element it does not know, with its content",
    `<p>a</p><my-note>Contact support</my-note>`,
    `<p>a</p>`,
  ],
  [
    "strips javascript: links an atom would render",
    `<zl-pill href="javascript:alert(1)">x</zl-pill><zl-field name="p" label="x" forgot-password-href=" java\tscript:alert(1)"></zl-field>`,
    `<zl-pill>x</zl-pill><zl-field name="p" label="x"></zl-field>`,
  ],
  [
    "strips data: links an atom would render, but keeps a data: image",
    `<zl-pill href="data:text/html,x">x</zl-pill><img src="data:image/png;base64,AAAA" alt="">`,
    `<zl-pill>x</zl-pill><img src="data:image/png;base64,AAAA" alt="">`,
  ],
  [
    "strips a srcset with a script URL",
    `<img src="a.png" srcset="javascript:alert(1) 1x, b.png 2x" alt="">`,
    `<img src="a.png" alt="">`,
  ],
  [
    "keeps text that only looks like a script URL",
    `<p title="javascript:void" data-x="javascript:1">x</p>`,
    `<p title="javascript:void" data-x="javascript:1">x</p>`,
  ],
  [
    "drops embedded content with its fallback text",
    `<p>a</p><object data="https://evil.example/x"><embed src="https://evil.example/y">text</object>`,
    `<p>a</p>`,
  ],
  ...[
    `<svg><a href="javascript:alert(1)"><text>x</text></a></svg>`,
    `<math><mtext><table><mglyph><style><img src=x onerror=alert(1)></style></mglyph></table></mtext></math>`,
    `<noscript><p>n</p></noscript>`,
    `<marquee>m</marquee>`,
    `<details><summary>s</summary>d</details>`,
    `<video src="https://evil.example/v"></video>`,
    `<select><option>o</option></select>`,
    `<template><p>t</p></template>`,
    `<font>f</font><center>c</center>`,
  ].map((input): [string, string, string] => [
    `drops ${input.slice(0, input.indexOf(">") + 1)} with its content`,
    `<p>a</p>${input}`,
    `<p>a</p>`,
  ]),
  ...["name", "title", "id", "action", "method", "length", "location", "body", "domain"].map(
    (value): [string, string, string] => [
      `keeps a field named "${value}" that collides with a DOM property (#2532)`,
      `<zl-field name="${value}" label="x"></zl-field>`,
      `<zl-field name="${value}" label="x"></zl-field>`,
    ],
  ),
];

describe("NativeSanitiser", () => {
  it.runIf(supported).each(cases)("%s", (_name, input, expected) => {
    expect(new NativeSanitiser().sanitise(input)).toBe(expected);
  });

  it.each(cases)("%s with DOMPurify, as Safari does", (_name, input, expected) => {
    expect(purify.sanitise(input)).toBe(expected);
  });
});
