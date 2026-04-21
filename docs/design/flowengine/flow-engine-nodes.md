# Flow Engine — Step Response Shape

> **Status:** Open — decision needed
> **See also:** [Flow Engine](flow-engine.md) · [User Schema Integration](user-schema.md)


The flow API returns **functional data** — what the user needs to provide and what actions are available. Layout, styling, and visual presentation are a separate concern (see future BDUI layout document).

Step-level metadata (`label`, `description`, `error`) covers text content. The remaining question is how to structure the interactive elements. The key trade-off is **ordering control vs. frontend simplicity**.

## The Problem

A login step can contain several kinds of interactive elements:
- **Input fields** — email, password, OTP code
- **Submit buttons** — primary form submission
- **Auth method widgets** — SSO buttons, passkey ceremony, captcha challenge
- **Navigation links** — "Create account", "Forgot password?"

Admins want to control the **visual order** of these elements. One admin wants "Continue with Google" above the email field. Another wants email/password front and center with SSO options below. The question is: how does the API express this ordering?

Three options are under consideration, ranging from **no cross-element ordering** to **full ordering of everything**.

---

## Option A: Grouped Sections

Three separate typed arrays. The frontend decides how to arrange the sections relative to each other.

```
┌─────────────────────────────────┐
│  fields[]     → input elements  │  Order within each section
│  actions[]    → buttons         │  is controlled by the server.
│  components[] → SSO, passkey…   │
└─────────────────────────────────┘
  But the frontend decides:
  "Do fields go above components? Or below?"
```

```json
{
  "step": {
    "name": "identifier",
    "type": "identifier",
    "label": "Sign in",
    "fields": [
      { "name": "identifier", "label": "Email", "type": "email" }
    ],
    "actions": [
      { "name": "submit", "label": "Continue", "primary": true },
      { "name": "register", "label": "Create account" }
    ],
    "components": [
      { "type": "sso", "provider": "google", "label": "Continue with Google" },
      { "type": "passkey", "label": "Sign in with passkey" }
    ]
  }
}
```

**Pros:**
- Simplest to parse — each array has a uniform schema, no type discrimination needed.
- Frontend always knows exactly where to look for each kind of element.

**Cons:**
- **No cross-section ordering.** An admin cannot say "SSO above email" or "passkey before password." The frontend hardcodes the section layout.
- Every frontend must make the same layout decision (fields first? components first?), leading to inconsistency across clients or a de-facto convention that defeats the purpose of BDUI.

---

## Option B: Ordered Elements Array

A **single flat array** containing all interactive elements. Each element has a `kind` discriminator. Array order = render order. The server has full control.

```
┌─────────────────────────────────────┐
│  elements[] → everything, ordered   │  Server controls top-to-bottom
│    { kind: "field", ... }           │  render order of ALL elements.
│    { kind: "sso", ... }             │
│    { kind: "submit", ... }          │
│    { kind: "link", ... }            │
└─────────────────────────────────────┘
```

```json
{
  "step": {
    "name": "identifier",
    "type": "identifier",
    "label": "Sign in",
    "elements": [
      { "kind": "field",   "name": "identifier", "label": "Email", "field_type": "email" },
      { "kind": "submit",  "name": "submit",     "label": "Continue", "primary": true },
      { "kind": "sso",     "name": "google",     "label": "Continue with Google", "provider": "google" },
      { "kind": "sso",     "name": "entra",      "label": "Continue with Microsoft", "provider": "entra" },
      { "kind": "passkey", "name": "passkey",     "label": "Sign in with passkey" },
      { "kind": "link",    "name": "register",   "label": "Create account" }
    ]
  }
}
```

**SSO-first login** — just reorder the array:

```json
{
  "elements": [
    { "kind": "sso",     "name": "google",     "label": "Continue with Google", "provider": "google" },
    { "kind": "sso",     "name": "entra",      "label": "Continue with Microsoft", "provider": "entra" },
    { "kind": "field",   "name": "identifier", "label": "Email", "field_type": "email" },
    { "kind": "submit",  "name": "submit",     "label": "Continue with email", "primary": true },
    { "kind": "link",    "name": "register",   "label": "Create account" }
  ]
}
```

**Registration** — simple form, same structure:

```json
{
  "step": {
    "name": "register_profile",
    "type": "form",
    "label": "Create your account",
    "elements": [
      { "kind": "field",  "name": "email",       "label": "Email",      "field_type": "email", "required": true },
      { "kind": "field",  "name": "given_name",   "label": "First name", "field_type": "text",  "required": true },
      { "kind": "field",  "name": "family_name",  "label": "Last name",  "field_type": "text",  "required": true },
      { "kind": "submit", "name": "submit",       "label": "Continue", "primary": true },
      { "kind": "link",   "name": "login",        "label": "Already have an account? Sign in" }
    ]
  }
}
```

**Captcha:**

```json
{
  "step": {
    "name": "bot_check",
    "type": "captcha",
    "label": "Verify you are human",
    "elements": [
      { "kind": "captcha", "name": "captcha", "label": "Complete the challenge",
        "config": { "provider": "altcha", "algorithm": "SHA-256", "challenge": "abc...", "salt": "xyz...", "max_number": 100000 } }
    ]
  }
}
```

**Pros:**
- **Full ordering control over everything.** SSO above fields, fields above SSO, passkey between two input fields — any layout the admin wants.
- Single array to iterate — rendering is a straightforward `for element in elements: render(element.kind)`.
- No ambiguity about relative positioning. The API response *is* the render order.

**Cons:**
- Discriminated union — the frontend needs a `switch(element.kind)` to render each type.
- Extracting "just the fields" or "just the submit action" requires filtering the array (e.g., to build a `<form>` tag around only the input fields).
- Validation is more complex — the schema uses `oneOf`/`discriminator` instead of uniform arrays.

---

## Option C: Fields Separate, Actions Merged

A hybrid: **fields** stay in their own array (since they're always rendered as a form group), but everything else — submit buttons, SSO, passkey, links — goes into a single ordered **actions** array.

```
┌──────────────────────────────────────┐
│  fields[]  → input elements (form)   │  Always rendered as a group.
│  actions[] → everything else         │  Server controls order of
│    { kind: "submit", ... }           │  buttons, auth methods, links.
│    { kind: "sso", ... }              │
│    { kind: "link", ... }             │
└──────────────────────────────────────┘
```

```json
{
  "step": {
    "name": "identifier",
    "type": "identifier",
    "label": "Sign in",
    "fields": [
      { "name": "identifier", "label": "Email", "type": "email" }
    ],
    "actions": [
      { "kind": "submit",  "name": "submit",   "label": "Continue", "primary": true },
      { "kind": "sso",     "name": "google",   "label": "Continue with Google", "provider": "google" },
      { "kind": "sso",     "name": "entra",    "label": "Continue with Microsoft", "provider": "entra" },
      { "kind": "passkey", "name": "passkey",  "label": "Sign in with passkey" },
      { "kind": "link",    "name": "register", "label": "Create account" }
    ]
  }
}
```

**SSO-first login:**

```json
{
  "fields": [
    { "name": "identifier", "label": "Email", "type": "email" }
  ],
  "actions": [
    { "kind": "sso",     "name": "google",   "label": "Continue with Google", "provider": "google" },
    { "kind": "sso",     "name": "entra",    "label": "Continue with Microsoft", "provider": "entra" },
    { "kind": "submit",  "name": "submit",   "label": "Continue with email", "primary": true },
    { "kind": "link",    "name": "register", "label": "Create account" }
  ]
}
```

**Registration:**

```json
{
  "step": {
    "name": "register_profile",
    "type": "form",
    "label": "Create your account",
    "fields": [
      { "name": "email", "label": "Email", "type": "email", "required": true },
      { "name": "given_name", "label": "First name", "type": "text", "required": true },
      { "name": "family_name", "label": "Last name", "type": "text", "required": true }
    ],
    "actions": [
      { "kind": "submit", "name": "submit", "label": "Continue", "primary": true },
      { "kind": "link",   "name": "login",  "label": "Already have an account? Sign in" }
    ]
  }
}
```

**Captcha:**

```json
{
  "step": {
    "name": "bot_check",
    "type": "captcha",
    "label": "Verify you are human",
    "fields": [],
    "actions": [
      { "kind": "captcha", "name": "captcha", "label": "Complete the challenge",
        "config": { "provider": "altcha", "algorithm": "SHA-256", "challenge": "abc...", "salt": "xyz...", "max_number": 100000 } }
    ]
  }
}
```

**Pros:**
- Fields are uniform and easy to render as a form group — no type switching needed for inputs.
- **Full ordering control for auth methods, buttons, and links** — the common customization use case ("SSO above or below submit").
- The discriminated union is limited to `actions` — simpler than Option B where fields are also in the mix.

**Cons:**
- Still a discriminated union in `actions` — frontend needs `switch(action.kind)`.
- Cannot interleave fields with non-field elements (e.g., an info banner between two input fields). Fields are always a block.

---

## Comparison

| Concern | A: Grouped Sections | B: Single Array | C: Fields + Actions |
|---|---|---|---|
| Cross-element ordering | None — frontend decides section layout | Full — any element anywhere | Partial — fields are a block, everything else is ordered |
| Frontend complexity | Simplest — 3 uniform arrays | Most complex — discriminated union for all elements | Middle — uniform fields array, discriminated actions |
| Admin control over auth method position | None | Full | Full |
| Extracting fields for `<form>` tag | Trivial — `step.fields` | Filter by `kind == "field"` | Trivial — `step.fields` |
| Interleave fields with non-fields | No | Yes | No |
| Registration / simple forms | Clean | Clean | Clean |
| Schema validation complexity | Low — uniform arrays | High — `oneOf` discriminator | Medium — one uniform + one discriminated |

> **Decision: TBD.** The main question is whether admins need to interleave fields with non-field elements (favors B), or whether ordering control over auth methods/buttons is sufficient (favors C). Option A is simplest but gives up the most common customization request: controlling where SSO buttons appear relative to the login form.
