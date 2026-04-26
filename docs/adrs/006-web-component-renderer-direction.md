# ADR 006: Web Component Renderer Direction

> **Status:** Proposed
> **Date:** 2026-04-26
> **Context:** Future Zitadel auth UI renderer

## Decision

The target renderer is a web component, shaped as:

```html
<zitadel-flow purpose="login" project-id="..." issuer="..."></zitadel-flow>
```

This PR does not build the web component. It prepares the contract by using `ZitadelFlow({ purpose, projectId, issuer, environment })` in the React/Next shim and advertising the planned `web-component` renderer as unavailable until the package ships.

## Context

Web components give Zitadel one framework-neutral renderer that agents can host from React, Vue, Svelte, Astro, vanilla HTML, and later frameworks without new SDK concepts.

## Consequences

- The React SDK is a temporary host/shim, not the long-term abstraction.
- Generated routes use `purpose`, not bespoke auth-mode vocabulary.
- The CLI can later swap the renderer without changing the app-level concept.
