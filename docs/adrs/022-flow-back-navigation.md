# ADR 022: Flow Back-Navigation

> **Status:** Accepted
> **Date:** 2026-05-21 (revised 2026-07-29 to match the shipped implementation)
> **Context:** Flow engine step traversal, browser History API, `<zitadel-login>` orchestrator

## Decision

Back-navigation in the flow engine uses the **existing action contract**.
The engine **injects** a `back` action on steps where returning to the
previous step is allowed — flow authors do not declare back transitions
per step. The orchestrator submits `{ action: "back" }` like any other
action. The engine pops the previous step from the runtime history and
returns it.

The `<zitadel-login>` orchestrator additionally integrates with the browser's
**History API** so that the native back gesture (swipe, button, keyboard
shortcut) maps to the same `back` action — without reloading the page or
losing widget state.

### The `back` action

`back` is an action with `kind: "back"`. The name is conventionally
`"back"` but only the `kind` is load-bearing — clients identify the
back action by kind, never by name:

```json
{
  "step": {
    "name": "passkey-upsell",
    "actions": [
      { "name": "setup", "kind": "passkey_register", "text_key": "passkey-upsell.action.setup", "primary": true },
      { "name": "skip",  "kind": "navigate",         "text_key": "passkey-upsell.action.skip" },
      { "name": "back",  "kind": "back",             "text_key": "action.back" }
    ]
  }
}
```

When submitted:

```
POST /flow/{id}/submit { session_token, action: "back" }
```

The engine pops the previous step from the runtime `history` array stored
in the encrypted flow cookie and returns it as the new step response. The
session token rotates as usual. No special API endpoint, no per-step
`back` transition in the flow definition.

### When the engine injects `back`

The engine adds a `kind: "back"` action to the step's `actions` iff
**both** of the following hold:

1. The runtime `history` array has at least one prior step.
2. The current step is not terminal.

Reversibility is folded into rule 1: the engine pushes onto `history`
only on reversible transitions, and **clears** `history` on irreversible
ones (e.g., the action just created the user or rotated a credential).
The engine classifies reversibility from the semantics of the action it
executed — flow definitions carry no reversibility metadata.

The frontend never needs to hardcode which steps support back — the
presence or absence of a `kind: "back"` action in the response is the
single source of truth.

### Browser History API integration

The orchestrator keeps **at most one** same-document history entry — the
*sentinel* — on the stack while the current step carries a `kind: "back"`
action. The sentinel is pushed with
`history.pushState({ ...history.state, zl: true }, "")`, reusing the
current URL and spreading the host's existing state — SPA routers
(e.g. vue-router's `position`/`back`/`forward`) keep reading a
consistent sequence, and the sentinel stays transparent to them. No
fragments, no visible URL change, no interaction with hash-router
host apps. Its only job is to make the
browser's native back gesture fire `popstate` instead of leaving the page.

#### Lifecycle

1. **On each applied step response:**
   - Step has a `kind: "back"` action and the widget is not armed →
     push the sentinel, mark armed.
   - Step has no back action and the widget is armed → mark disarmed and
     retire the sentinel with a self-initiated `history.back()` (flagged,
     so the resulting `popstate` is ignored) — but **only while the
     sentinel is still the top entry** (`history.state.zl`). If the host
     pushed its own entry after arming, traversing would pop the host's
     entry and trigger a navigation the user never asked for; the
     sentinel leaks instead (the same tradeoff as disconnect) and the
     `popstate` handler skips stale sentinels in one extra hop from
     either direction. The next back press then navigates the host page —
     the flow is transparent to history once back is unavailable.
   - Arming only on the unarmed → armed transition means consecutive
     back-capable steps — and re-renders of the *same* step, e.g. after a
     failed submit — never grow the stack.

2. **On `popstate`:**
   - Self-initiated (retire in progress) → ignore.
   - Armed, and the landing state **is** the sentinel → the host page had
     pushed an entry above ours (e.g. an in-page `#anchor` click) and the
     user backed out of it. Position is as expected; the gesture was aimed
     at the host entry, not the flow. Do nothing.
   - Armed, otherwise → the browser consumed the sentinel: **re-arm it
     immediately**, then submit the step's back action. Re-arming first
     keeps the stack shape identical at every flow depth, so repeated
     presses behave the same no matter how deep the user is.
   - Disarmed, landing on a retired sentinel (it survives as a *forward*
     entry after retirement) → bounce with `history.back()`. Flow state is
     server-authoritative; the browser cannot skip ahead.
   - Anything else is host-page traversal — leave the browser alone.

3. **`connectedCallback` / `disconnectedCallback`** add and remove the
   `popstate` listener. A sentinel left on the stack by a disconnect is a
   harmless no-op entry; it is deliberately *not* cleaned up on
   disconnect, because Lit disconnects also fire on DOM moves and touching
   history there could fight a host router mid-navigation.

#### Why a single re-armed entry?

An earlier draft of this ADR used one fragment entry per step (`#s1`,
`#s2`, …) with a `stepSeq` counter. Review killed it: the per-step stack
drifts from the flow position on every back-submit, which produced
unreachable forward-detection logic, a back-button trap once stale
entries accumulated, and stack growth on same-step re-renders. The single
sentinel makes those states unrepresentable:

- The stack never grows, so there is nothing to drain and no trap.
- The URL never changes, so hash-router hosts are unaffected.
- There is no counter to reset between flows.
- It is the standard intercept pattern browsers and users already know
  from modals and wizards.

#### Edge cases

| Scenario | Behavior |
|---|---|
| Back press on the initial step | Never armed → browser navigates the host page (leaves the flow) — correct |
| Back press on a back-capable step | Sentinel consumed → re-armed, back action submitted |
| Back press after returning to a step without back | Sentinel already retired → browser navigates the host page |
| Forward press onto a retired sentinel | Bounced with `history.back()` — flow state is server-authoritative |
| Host pushes an entry above the sentinel (e.g. `#anchor`) | Backing out of it lands on the sentinel → no-op, widget stays armed |
| Multiple rapid back presses | Each `popstate` re-arms; submits are serialized by the loading guard, so presses during an in-flight submit are absorbed |
| Embedded in a SPA with its own router | Router navigation via `pushState`/`replaceState` fires no `popstate`; when disarmed the handler only reacts to its own tagged (`zl`) entries |

### Template rendering

Templates render **no visible control** for the back action — the
browser's native back gesture (mapped to the wire action by the History
API integration above) is the affordance. This mirrors modern auth flows:
back splits into *data correction* (served contextually where needed) and
*step traversal* (served by the gesture); a generic "Back" control serves
both poorly and adds card noise.

The back action is deliberately **excluded from the generic
secondary-action loop** — templates filter it by kind, never by name, so
an engine-injected back can never surface as an off-design secondary
button:

```liquid
{% unless a.primary or a.kind == 'back' or ... %}
  <zl-button ... ></zl-button>
{% endunless %}
```

The default template and every shipped branding design carry this
exclusion. Tenant templates remain free to render an explicit control
from the wire action (`kind: "back"` and its `text_key` stay on the
response); the contract encodes no flow topology client-side, and neither
must any template that renders it.

### Mock server changes

The xstate mock approximates the production injection rules rather than
deriving them from a runtime history: fixtures advertise a `kind: "back"`
action on steps whose real counterparts have a reversible predecessor
(`password`, `register-password`), and the machine carries explicit
guarded `back` transitions for those states. Initial steps (`identifier`,
`register`) and states unreachable in the default flow advertise no back
action — an unreachable state must not encode a predecessor relationship
that no path produces.

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

- **`step-action.yaml`** — `kind` enum gains `back`. Clients identify the
  back action by `kind: "back"`, never by name.
- **`flow-submit-request.yaml`** — unchanged. `back` is already documented
  as a valid action value.
- **Flow definitions** — unchanged. No per-step `back` transitions and no
  reversibility metadata; the engine derives back from the runtime
  `history` array (see `flow-engine-storage.md`) and from the semantics
  of the actions it executes.
- **`zitadel-login.ts`** — gains the sentinel arm/retire logic in
  `applyResponse` and the `popstate` handler described above.
- **Templates** — the default template and the branding design catalog
  exclude `kind: "back"` from the generic secondary-action loop and
  render no control for it.
- **Locale files** — gain `action.back` translation key.
- **Mock server** — `flow-machine.ts` carries explicit guarded `back`
  edges and the fixtures advertise the action, approximating the
  production injection rules (see §Mock server changes).

[storage]: ../design/flowengine/flow-engine-storage.md
[submit]: ../../api/openapi/components/flows/flow-submit-request.yaml
