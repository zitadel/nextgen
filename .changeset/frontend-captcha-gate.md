---
"@zitadel/components": minor
---

Implement the frontend captcha gate (ADR 019): a new invisible `<zl-captcha>`
atom solves a step's `captcha` gate — built-in Altcha proof-of-work (with a
Web Worker fast path) or a third-party widget (Turnstile, hCaptcha,
reCAPTCHA) mounted in light DOM — and emits the proof as an opaque string.
The `mandatory-gates` patcher now actually injects the gate consumer it
always documented: any `step.gates` entry without a matching `<zl-captcha>`
in the template gets one, so templates need no gate markup. The orchestrator
collects proofs and sends them as `gate_proofs` on submit, and surfaces
`error.gate_failed` (new locale key in en/de/it) when solving fails.

Invisible atoms are now uniformly null-safe: `<zl-passkey>` and
`<zl-captcha>` idle silently when mounted without challenge data and start
automatically when it arrives; an explicit `startCeremony()`/`startSolve()`
without data still reports an error event.

The api-mock issues a real Altcha challenge on the identifier step
(`bot_check`) and, when `setupMockHandlers({ verifyGates: true })` is set
(the standalone dev server does), verifies submitted proofs and re-renders
the step with a fresh challenge on failure.
