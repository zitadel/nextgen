# ADR 014: Captcha Gate Contract and Implementation

## Status
Proposed

## Context
The [Bot Detection & Captcha](../design/flowengine/bot-detection.md) design specifies that captcha challenges (like Altcha, reCAPTCHA, and Turnstile) will be delivered to the client as **Gates**. These gates can be injected statically via flow definitions or dynamically by the risk evaluation engine.

Currently, the Flow API defines `gates` in `flow-step.yaml` with a generic `config` property to support any provider. However, the `gate_proofs` submission map in `flow-submit-request.yaml` is strictly typed as a map of strings (`additionalProperties: { type: string }`).

This creates a mismatch: while reCAPTCHA simply returns a string token, providers like Altcha use a structured JSON payload (`{ salt: string, number: number }`). We need a unified approach to rendering these challenges and submitting their proofs.

## Decision

### 1. Relax the `gate_proofs` Schema
We will change `gate_proofs` in `flow-submit-request.yaml` from `additionalProperties: { type: string }` to `additionalProperties: true`.
This mirrors the decision in ADR 011 for passkeys, allowing the Flow Engine to act as a transparent pipe that passes provider-specific JSON proofs directly to the backend verifiers without requiring constant OpenAPI schema updates.

### 2. Provider-Specific Atoms
The frontend will implement provider-specific Lit components:
- `<zl-altcha>`: Runs a Web Worker to compute the SHA-256 proof-of-work.
- `<zl-recaptcha>`: Injects the Google script and mounts the widget.

### 3. Template Integration and `<zl-gates>`
To simplify the Liquid authoring experience, we will introduce a `<zl-gates>` container atom. Instead of writing Liquid `for` loops or relying solely on the `{% fallback_ui %}` fallback, template authors can explicitly place all security gates in their layout with a single tag:

```liquid
<zl-gates gates='{{ gates | json }}'></zl-gates>
```

The `<zl-gates>` component will:
- **Autodetect visibility:** If the `gates` object is empty, or if all required gates are already satisfied, the component gracefully renders nothing. The author does not need to wrap it in `{% if gates %}`.
- **Dynamic mounting:** It will internally iterate through the unsatisfied gates and mount the appropriate provider atoms (e.g., `<zl-altcha config='...'>`, `<zl-recaptcha config='...'>`).

The `{% fallback_ui %}` patcher will still act as a structural safety net: if a required gate is missing from the DOM, the patcher will automatically append the missing gates to the end of the form using dynamic tag names (`<zl-${gate.provider}>`).

### 4. Event Normalization
All gate components will emit a standardized `zl-gate-result` event containing the gate name and the proof object. The orchestrator (`<zitadel-login>`) will collect these events into a local state map, appending them to the `gate_proofs` dictionary upon the next `submit` action.

## Consequences
- **Positive:** We decouple the OpenAPI specification from the nuances of individual bot detection providers.
- **Positive:** We enable privacy-preserving, self-hosted Altcha integration without ugly base64-stringification of JSON payloads.
- **Negative:** The backend (Go flow engine) must be updated to parse unstructured JSON proofs for gates, sacrificing strict automatic OpenAPI validation for flexibility.
