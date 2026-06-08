# Deferred Lit "Tier B" findings

This note records architectural refactors that were **considered and
deliberately deferred** during the 2026-06 web-components audit. Phases 1-5 of
that audit shipped (documentation truth-up, manifest correctness, internal
tidy, a unit/browser test gate, and the full set of Tier A idiomatic Lit
refactors). The items below are Tier B — they change *structure*, not
behaviour, and were judged to add abstraction without enough payoff to justify
the churn right now.

Re-open any of these when a concrete second consumer or requirement appears.

## 1. WebAuthn ceremony `ReactiveController` (`zl-passkey`)

**Idea.** Move the ceremony in [`src/atoms/zl-passkey.ts`](../src/atoms/zl-passkey.ts)
(`startCeremony` / `getCredential` / `createCredential` /
`decodeCredentialDescriptors` / `serializeCredential` / `abort`) into a
`WebAuthnCeremonyController` whose `hostConnected` auto-starts (when
`!manual && options`) and whose `hostDisconnected` aborts.

**Why deferred.** `zl-passkey` is already a single-purpose ceremony handler —
the element *is* the ceremony. Extracting a controller is a lateral,
organizational move with no behaviour change and no second host that needs the
logic. The ceremony is already well covered by
[`zl-passkey.spec.ts`](../src/atoms/zl-passkey.spec.ts) (error paths, manual vs
auto-start, abort-on-disconnect, serialize/decode), so the safety net exists if
this is picked up later.

## 2. Dropdown dismiss `ReactiveController` (`zitadel-logout`)

**Idea.** Extract the open + outside-click + Escape + focus-return logic in
[`src/orchestrator/zitadel-logout.ts`](../src/orchestrator/zitadel-logout.ts)
(`handleDocumentClick` / `handleDocumentKeydown` + the connect/disconnect
listener wiring) into a reusable `DismissController` that manages the document
listeners through `hostConnected` / `hostDisconnected`.

**Why deferred.** It is a textbook controller, but **single-use** today.
Extracting a shared abstraction for one consumer is premature; do it when a
second dismissable popover/dropdown component lands. Behaviour is pinned by
[`zitadel-logout.browser.spec.ts`](../src/orchestrator/zitadel-logout.browser.spec.ts).

## 3. `@lit/context` for branding / theme / locale

**Idea.** Distribute branding, theme, and locale to descendants via
`@lit/context` instead of properties.

**Why deferred.** There is no real property-drilling problem to solve. The
orchestrator applies branding/theme as **CSS custom properties on its own
shadow root**, which inherit into the atoms automatically (see
`branding-to-tokens.ts` and the `applyBrandingTokens` / `applyBaseTokens`
calls). Atoms do not read branding values in JS. Adding a context layer would
be speculative architecture.

## What *was* done (Tier A, for reference)

- `classMap` replaced manual class-string concatenation in `zl-button`,
  `zl-icon`, `zl-pill`, `zl-field`.
- `live()` + `ifDefined` on the `zl-field` input binding/attributes; `@query`
  for the inner input.
- Reactive `data-state` property on `zl-button` (was a non-reactive
  `getAttribute` in `render`).
- `slotchange` -> `requestUpdate` made `zl-card` / `zl-page-shell` empty-region
  detection reactive (still reads children synchronously on first render to
  avoid an empty-then-filled flash).
- A shared `emit()` helper (`src/internal/emit.ts`) for the
  `bubbles + composed` custom-event shape, adopted across atoms and both
  orchestrators.
- The orchestrator's double `requestAnimationFrame` focus hack replaced with a
  deterministic `await this.updateComplete` + child-atom `updateComplete`
  await before hydrating values / moving focus.
