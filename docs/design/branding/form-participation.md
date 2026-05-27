# Form participation, focus, and accessibility

How `<zitadel-login>` and the `<zl-*>` atoms keep the login UI accessible and well-behaved with password managers / autofill / screen readers, while remaining encapsulated inside Shadow DOM.

**See also:** [`../cli/bdui-renderer.md`](../cli/bdui-renderer.md) (why Shadow DOM), [`../flowengine/template-security.md`](../flowengine/template-security.md) (`innerHTML` pipeline), [`templates.md`](templates.md) (atom contract), [`validator.md`](validator.md) (`{% required_atoms %}`).

## The tension

We use Shadow DOM for [stable styling](../cli/bdui-renderer.md): customer Tailwind / CSS resets / design systems must not be able to mangle our login UI. That is non-negotiable.

Out of the box, putting form controls inside Shadow DOM breaks four things people rightly expect from a sign-in screen:

1. **Form participation.** A plain `<input>` inside a shadow root does *not* contribute its value to a `<form>` in light DOM. The login form is not a form anymore; just a soup of disconnected fields.
2. **Enter-to-submit.** Pressing Enter inside a field submits the *enclosing* form. There is none, so Enter is a no-op.
3. **Password managers and autofill.** 1Password / Bitwarden / browser autofill find sign-in forms by walking the DOM and looking for `<form>` elements that contain `username` + `password` controls. A flat shadow-DOM tree with no form is invisible to them.
4. **Focus management on step swap.** When the orchestrator re-renders a new step the previously focused element is gone, and the browser parks focus at `document.body`. Screen-reader and keyboard users get dumped at the top of the page.

## Decision

Keep Shadow DOM for styling, fix form behaviour with web platform features. Specifically:

| Concern | Mechanism | Owner |
| --- | --- | --- |
| Form value participation | [Form-associated custom elements](https://developer.mozilla.org/en-US/docs/Web/API/Web_components/Using_custom_elements#form-associated_custom_elements) (`static formAssociated = true` + `attachInternals().setFormValue()`) | each `<zl-*>` input atom |
| Real `<form>` element | Rendered inside `<zitadel-login>`'s shadow root, wraps the Liquid output | `<zitadel-login>` |
| Submit interception | Native `submit` event listener on the shadow root; `preventDefault()` then call the flow API | `<zitadel-login>` |
| Enter-to-submit | Each field forwards `keydown[Enter]` to `internals.form.requestSubmit()` | `<zl-field>` |
| Validity state | `internals.setValidity()` mirrors `required` / step-level errors | each input atom |
| Reset / restore | `formResetCallback`, `formStateRestoreCallback` clear / restore `value` | each input atom |
| Focus delegation | `static shadowRootOptions = { delegatesFocus: true }` | every atom + orchestrator |
| Step-change focus | Orchestrator focuses the first field when `step` changes | `<zitadel-login>` |
| Aria refs | `aria-describedby` only references ids that have content (no dangling refs) | `<zl-field>` |

Why these specifically:

- **Form-associated custom elements** are W3C standard and shipped in every evergreen browser since 2023 (Safari 16.4 was the last to land). Modern password managers (1Password 8+, Bitwarden, browser built-ins) walk the form by talking to the platform, not by piercing shadow roots, so once each atom calls `setFormValue` they're visible.
- **Real `<form>`** is what password managers and the browser's autofill / save-password heuristics actually look for. We don't navigate on submit (we own the cycle via fetch), but the form being present is what triggers detection.
- **`delegatesFocus: true`** makes the shadow boundary transparent for keyboard tab order. It also lets `:focus-visible` styling on the host work as users expect.
- **Step-change focus move** keeps screen-reader and keyboard users oriented across step swaps.

## What we are not relying on

- **Cross-root `aria-labelledby`.** A label in the orchestrator's shadow DOM cannot reference an input in a child atom's shadow DOM. The `reference-target` proposal isn't shipped yet. We instead label the input *inside* the same shadow root as the input — `<zl-field>` owns its own `<label for=...>`, and the host element only hosts that whole field.
- **Composed `change` events bubbling.** `change` does not bubble across shadow boundaries by default. Atoms re-fire `change` from the host with `composed: true` so light-DOM listeners (and password managers that key on `change`) see it.
- **Native form submission posting to a URL.** The orchestrator intercepts `submit`, calls the Flow API via fetch, and applies the next step. The browser's "save password" prompt fires on form submission and successful login navigation; for SPA logins we accept that some browsers won't prompt until the navigation following completion. This is the same trade-off every modern SPA makes.

## Cross-framework story

The mechanism is web-standards, so frameworks don't have to do anything special:

- **Next.js / React.** Drop `<zitadel-login>` in. With `@lit/react` you get typed props; without it, all attributes work.
- **Astro.** Use the element directly in `.astro` templates. SSR rendering uses Lit's [Declarative Shadow DOM](https://web.dev/articles/declarative-shadow-dom) — the server emits `<template shadowrootmode="open">` and the browser hydrates on parse. No client-side flicker.
- **Remix / SvelteKit / Nuxt.** Same as Astro: native HTML, optional DSD.
- **Vue.** Native usage works; `defineCustomElement` available if you want a Vue-flavoured wrapper.
- **Plain HTML.** Just a `<script type="module">` import and the tag.

Form participation works the same way in every host: as long as `<zitadel-login>`'s `<form>` is in the page and the atoms inside it are form-associated, the host framework's form lifecycle (or absence of one) doesn't matter.

## Testing notes

- Unit specs live next to the implementation (`zl-field.spec.ts`, `zitadel-login.spec.ts`).
- Lit tests run in `jsdom`; jsdom implements `ElementInternals` and form-associated custom elements as of jsdom 24.
- Browser smoke checks should cover: Tab order, Enter-to-submit from each field, password manager visibility (manual), focus landing on the first field after a step change, screen-reader announcement of `aria-busy` and step-level errors.

## Where the rules live in code

- `packages/components/src/atoms/zl-field.ts` — `formAssociated`, `attachInternals`, `setFormValue`, `setValidity`, Enter-key forwarding, `delegatesFocus`, `aria-describedby` hygiene.
- `packages/components/src/orchestrator/zitadel-login.ts` — real `<form>`, native submit interception, primary-action fallback for keyboard submits, `delegatesFocus`, focus-on-step-change.
