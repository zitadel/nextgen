# ADR 016: Flow Back-Navigation

> **Status:** Proposed
> **Date:** 2026-05-21
> **Context:** Flow engine step traversal, browser History API, `<zitadel-login>` orchestrator

## Decision

Back-navigation in the flow engine uses the **existing action contract**.
The server declares a `back` action on steps where returning to the previous
step is allowed. The orchestrator submits `{ action: "back" }` like any other
action. The server follows the `back` transition in the flow definition and
returns the target step.

The `<zitadel-login>` orchestrator additionally integrates with the browser's
**History API** so that the native back gesture (swipe, button, keyboard
shortcut) maps to the same `back` action — without reloading the page or
losing widget state.

### The `back` action

`back` is a plain action — same shape as `submit` or `register`:

```json
{
  "step": {
    "name": "passkey-upsell",
    "actions": {
      "setup": { "text_key": "passkey-upsell.action.setup", "primary": true },
      "skip":  { "text_key": "passkey-upsell.action.skip" },
      "back":  { "text_key": "action.back" }
    }
  }
}
```

When submitted:

```
POST /flow/{id}/submit { session_token, action: "back" }
```

The server resolves this like any other action: it looks up the `back`
transition in the flow definition, follows it to the target step, and returns
the new step response. The session token rotates as usual. No special API
endpoint, no history stack popping — `back` is a regular edge in the
definition's step graph:

```json
{
  "name": "passkey-upsell",
  "transitions": {
    "setup": { "target": "done" },
    "skip":  { "target": "done" },
    "back":  { "target": "identifier" }
  }
}
```

### Server-side contract

The server controls **whether** back is allowed. It includes `back` in the
step's `actions` dict only when the flow definition declares a `back`
transition for the current step.

Steps where `back` is **not** offered:

| Step | Reason |
|---|---|
| Initial step (e.g. `identifier`) | No `back` transition defined — nowhere to go back to |
| Post-mutation steps | User was already created / credential was reset — irreversible |
| Terminal steps (`complete`) | Flow is done |

The frontend never needs to hardcode which steps support back — the presence
or absence of the `back` action in the response is the single source of truth.

### Browser History API integration

The orchestrator uses opaque, fragment-based `pushState` entries to give the
browser a history stack that mirrors the flow's step progression. This makes
the native back gesture work without page reloads.

#### Lifecycle

1. **On each step transition** (after `applyResponse`):
   - If the new step's `actions` contains `back` →
     `history.pushState(null, '', '#s' + this.stepSeq++)` — creates a
     history entry with an opaque, incrementing fragment (`#s1`, `#s2`, …).
     The fragment has no semantic meaning; it is never read back.
   - If the new step has no `back` action → `history.replaceState(...)` (no
     new entry — browser back navigates the host page, which is correct)

2. **On `popstate` event** (browser back button):
   - If the current step's `actions` contains `back` →
     submit `{ action: "back" }` to the API, apply the response
   - If no `back` action → call `history.forward()` to restore the
     consumed entry without growing the stack, and surface a brief
     visual indicator that going back is not available. This avoids
     trapping the user in an ever-growing back loop — the history
     stack stays fixed and the host page remains reachable once the
     flow's entries are exhausted

3. **On `disconnectedCallback`** (widget removed):
   - Remove the `popstate` listener — clean up

#### Why fragments?

Fragment-only URL changes (`#s1` → `#s2`) are **same-document
navigation**. The browser:

- Does **not** reload the page
- Does **not** unmount the DOM
- Does **not** clear JavaScript state
- Only fires a `popstate` event

The `<zitadel-login>` element stays connected with all in-memory state
(`response`, `formValues`, `loading`) intact. The orchestrator simply catches
`popstate`, submits the `back` action, and re-renders with the API response —
identical to clicking an in-UI back button.

#### Edge cases

| Scenario | Behavior |
|---|---|
| User presses back on the initial step | No `back` action → browser navigates the host page (leaves the flow) — correct behavior |
| User presses forward after going back | `popstate` fires with a forward state — orchestrator calls `history.back()` to undo the traversal and keep the URL aligned with the displayed step. The flow state is server-authoritative; the browser cannot skip ahead. |
| Multiple rapid back presses | Each `popstate` triggers a sequential `submit("back")` — the session token rotation prevents race conditions |
| Embedded in a SPA with its own router | The host router and the flow's fragment entries coexist — fragments are scoped and don't conflict with path-based routing |

### Template rendering

The `default.liquid` template already iterates all non-primary actions and
renders them. A `back` action renders automatically as a secondary button or
link — no template changes required.

For visual consistency, the `back` action can be rendered as a left-arrow
link above the card (matching common auth UI patterns) by checking the
action key name in the template:

```liquid
{% if actions.back %}
  <a class="zl-card-nav__link" data-action="back">
    {{ actions.back.text_key | t }}
  </a>
{% endif %}
```

### Mock server changes

The xstate flow machine adds `back` transitions to steps that follow the
initial step:

```
passkey-upsell → back → identifier
register       → back → identifier
password       → back → identifier
```

Step fixtures include `back: { text_key: "action.back" }` in their `actions`
dict where appropriate.

## Context

The flow engine already has the server-side primitives for back-navigation:
the encrypted flow cookie stores a [`history` array][storage] that tracks
visited steps, and the [`flow-submit-request.yaml`][submit] documents `"back"`
as a valid action value.

However, no client-side implementation exists. The `<zitadel-login>`
orchestrator treats every step transition as forward-only, and the browser's
back button either does nothing or navigates away from the page.

Users expect the browser back button to work — especially on mobile where
the swipe-back gesture is the primary navigation pattern. Auth flows that
trap users (no visible back button, browser back breaks the flow) feel
broken and increase abandonment rates.

## Alternatives Considered

### 1. Dedicated `POST /flow/{id}/back` endpoint

A separate API endpoint for back-navigation.

**Rejected:** Unnecessary complexity. The submit endpoint already accepts
arbitrary action names. `back` is semantically identical to `submit` — it
advances (or regresses) the flow based on user intent. A separate endpoint
would duplicate validation, token rotation, and response formatting logic.

### 2. Client-side history only (no server round-trip)

The orchestrator caches previous step responses and restores them locally
on browser back, without calling the server.

**Rejected:** The server owns the flow state. Client-cached steps have stale
session tokens (the token rotates on every submit). Restoring a cached step
would desync the client and server — the next submit would fail with a token
mismatch. The server must be the source of truth for what step the user is on.

### 3. No browser history integration

Only in-UI back buttons, no `popstate` handling.

**Rejected:** Works functionally but ignores the primary navigation gesture
on mobile. Auth UX research consistently shows that trapping browser back
increases flow abandonment.

## Consequences

- **`step-action.yaml`** — unchanged. `back` is a plain action.
- **`flow-submit-request.yaml`** — unchanged. `back` is already documented
  as a valid action value.
- **Flow definitions** — gain `back` transitions on steps where backtracking
  is allowed. The `history` array in `flow-engine-storage.md` is unrelated
  internal bookkeeping — `back` is resolved via the transition graph.
- **`zitadel-login.ts`** — gains `pushState` calls on step transitions and a
  `popstate` listener.
- **Locale files** — gain `action.back` translation key.
- **Mock server** — `flow-machine.ts` gains `back` transitions;
  `fixtures/login.ts` gains `back` actions on applicable steps.

[storage]: ../design/flowengine/flow-engine-storage.md
[submit]: ../../api/openapi/components/flows/flow-submit-request.yaml
