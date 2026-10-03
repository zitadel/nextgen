---
name: zitadel
description: >-
  Add, configure, and manage Zitadel authentication in a project. Start here for
  any Zitadel task — it routes to the right skill: the `zitadel` CLI for creating
  projects, scaffolding, config, deploys, and the local server, and the
  per-framework SDK skills for integrating the auth UI into a Next.js, React,
  Angular, Nuxt, Vue, Solid, Svelte, or Qwik app. Use whenever the user mentions
  Zitadel, adding login/registration/sessions, or authentication in their app.
---

# Zitadel

This is the entry point for Zitadel work. Every Zitadel skill is installed
alongside this one; pick the right one for the task.

## Route by what you are doing

- **Create a project, scaffold a new app, change config, deploy, or run a local
  Zitadel server** → use **`zitadel-cli`**. It drives the `zitadel` CLI
  (`setup`, `plan`, `apply`, resource commands). It can scaffold a fresh app for
  any supported framework and integrate an **existing Next.js** app.

- **Integrate the auth UI into an app** → use the SDK skill for that framework:
  - Next.js → **`zitadel-sdk-next`**
  - React (including Vite SPAs and TanStack) → **`zitadel-sdk-react`**
  - Angular → **`zitadel-sdk-angular`**
  - Nuxt → **`zitadel-sdk-nuxt`**
  - Vue → **`zitadel-sdk-vue`**
  - Solid → **`zitadel-sdk-solid`**
  - Svelte → **`zitadel-sdk-svelte`**
  - Qwik → **`zitadel-sdk-qwik`**

- **Embed, theme, or drive the `<zitadel-login>` web component directly** → use
  **`zitadel-components`**.

## The rule that spans all of them

The CLI can **scaffold** a fresh app for every framework above, but it can only
**integrate (patch) an existing project for Next.js**. For an existing app in any
other framework, the CLI cannot wire it up on its own — reach for that framework's
SDK skill and add auth by hand: install `@zitadel/sdk-<framework>`, configure it,
add the provider/guard/routes, and drop in the login component. That SDK skill is
the authoritative path for the existing-app case.

Each skill points you at the package's real README and TypeScript types for exact
APIs — read those rather than guessing, since they move with the package version.
