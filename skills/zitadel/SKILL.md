---
name: zitadel
description: >-
  Add, configure, and manage Zitadel authentication in a project. Start here for
  any Zitadel task — it routes to the right skill: the `zitadel` CLI for creating
  projects, scaffolding, config, deploys, and the local server, and the
  per-framework SDK skills for integrating the auth UI into a Next.js, React,
  Angular, Nuxt, Vue, Solid, Svelte, or Qwik app. Also use to answer questions
  about Zitadel — its concepts, configuration, CLI, SDKs, or API — from the
  official docs. Use whenever the user mentions Zitadel, adding
  login/registration/sessions, or authentication in their app.
---

# Zitadel

This is the entry point for Zitadel work. The full set of Zitadel skills
installs together with `npx skills add zitadel/nextgen --full-depth`; this
router then points you at the right one for the task. If a skill named below is
not actually installed, the set was added without `--full-depth` — install it
that way to get the CLI and per-framework skills alongside this router.

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

## Zitadel documentation

The Zitadel docs cover what these skills do not: what each concept means and
how the pieces fit together. Read them to answer a question about Zitadel, to
understand a term or error before acting on it, or to check a claim you are not
sure of. Do not answer Zitadel questions from memory or training data; the
product is in preview and changes quickly.

The docs are organised into these sections:

| Section       | What it covers                                                         |
| ------------- | ---------------------------------------------------------------------- |
| Get started   | The quickstart, and driving the CLI as an agent                        |
| Concepts      | Projects, teams, users, flows, schemas, sessions, databases, SDK proxy |
| CLI           | Local runtime, `plan`/`apply`, login design and copy, troubleshooting  |
| SDKs          | One page per framework SDK, the API client, the login web component    |
| API reference | Every REST endpoint, grouped by resource                               |

### Finding the right page

Look the page up before you fetch it — don't guess URLs. The index lists every
page with a one-line description:

```
https://nextgen-docs-zitadel.vercel.app/llms.txt
```

Links in the index are relative to the docs site, so prefix them with
`https://nextgen-docs-zitadel.vercel.app`. Fetch only the pages you need. Do not
fetch `llms-full.txt`: it is the whole site in one file and costs far more
context than the one or two pages a question needs.

### Fetching a page as Markdown

Add `.md` to a page's URL to get it as Markdown instead of HTML, for example
`https://nextgen-docs-zitadel.vercel.app/docs/concepts/databases.md`.

### How far to trust the docs

The docs are written for the latest Zitadel release and are a good guide to how
Zitadel works, but they can lag behind or run ahead of the version the user has
installed: a flag, option, or field may have been renamed, added, or removed.
When the docs and the installed package disagree, the installed package wins —
check its README and TypeScript types, or the CLI's own `--help` output, and
tell the user when the docs are out of step with what you found.
