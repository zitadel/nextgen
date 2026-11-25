---
title: Zitadel NextGen 0.1.0, the first release
summary: "The first proper release, and the first on npm's latest tag: registration and login live in your app, under your brand, and an empty folder becomes an app with a working login in three commands."
date: 2026-10-21T23:50Z
pulls: [2215]
---

0.1.0 is the first proper release of Zitadel NextGen, and the first on npm's `latest` tag. Registration and login live in your app, under your brand, while Zitadel guards the credentials, sessions and tokens underneath. An empty folder becomes an app with a working login in three commands, with no account and no Docker:

```sh
npx @zitadel/cli@latest start
npx @zitadel/cli@latest setup --framework next --server local
npm run dev
```

This release sums up everything the alpha previews built; those versions are deprecated now. NextGen is still a preview: until 1.0.0, a minor release can include breaking changes, and each one is called out as breaking. The [quickstart](https://preview.zitadel.com/docs/get-started/quickstart) walks you through it.

### What you get

- **Sign-in and sign-up in your app.** `<zitadel-login>` runs the whole flow in one element: email and password, passkeys, and social sign-in with Google or any OIDC provider, where the first sign-in creates the account. `<zitadel-session>` and `<zitadel-logout>` show who is signed in and sign them out. For a UI of your own, the flow and auth-attempt APIs drive sign-in headless. [Components](https://preview.zitadel.com/docs/sdks/components)
- **12 frameworks.** `zitadel setup` creates a new app or patches an existing one with login, registration and profile pages, for Next.js, Nuxt, SvelteKit, SolidStart, Qwik Router, TanStack Start, React, Vue, Angular, Solid, Svelte and Qwik. The server SDKs keep auth on your own origin: they check sessions, protect routes and keep the project secret on the server. [SDKs](https://preview.zitadel.com/docs/sdks)
- **Users shaped by your schema.** A user schema in JSON Schema says which attributes your users have, which one they sign in with, which must be unique and which sign-in methods they may use. Every write is checked against it. [Flows and schemas](https://preview.zitadel.com/docs/concepts/flows-and-schemas)
- **Auth as code.** Schemas, login flows, branding and sign-in connections are files in your repository. `zitadel plan` checks them against the server's rules before anything changes, and `zitadel apply` publishes them as immutable revisions. [Plan and apply](https://preview.zitadel.com/docs/guides/plan-apply)
- **Your brand, your words.** Theme the login with `--zl-*` tokens and light and dark branding, or take over its markup with `zitadel branding eject`. Override any text per language; English, German and Italian are built in. [Design](https://preview.zitadel.com/docs/guides/customize-design), [copy](https://preview.zitadel.com/docs/guides/customize-copy)
- **A console.** At `/ui/console/`, manage users through forms built from your schema, as well as teams and project admins, and look through your schemas, flows, sign-in methods and branding, with a live preview of the login.
- **Create first, claim later.** `zitadel setup --server https://preview.zitadel.com` creates a hosted project without an account, and `zitadel claim` attaches it to your team within 14 days. [Projects and teams](https://preview.zitadel.com/docs/concepts/project-team-user)
- **Runs anywhere.** `zitadel start` runs the server from npm on your machine, with no Docker, Go or checkout, and signs you in to the console with a one-time link. To host it, take the binary for macOS, Linux or Windows or the image `ghcr.io/zitadel/nextgen`, with SQLite by default and PostgreSQL or Spanner in production. [Local runtime](https://preview.zitadel.com/docs/guides/local-runtime), [databases](https://preview.zitadel.com/docs/concepts/databases)
- **Audit events.** Sign-ins, sessions, users and configuration changes are recorded as typed events you can query through the API, and a self-hosted server can export them to a webhook. [Events](https://preview.zitadel.com/docs/reference/api/events)
- **One API for all of it.** Every operation is in the [API reference](https://preview.zitadel.com/docs/reference/api), with stable error codes. `zitadel api` calls any of them from the terminal, and `@zitadel/api` is a typed client with an error type per operation. [API client](https://preview.zitadel.com/docs/sdks/api-client)
- **Built for agents.** Every CLI command answers `--json` with one envelope. `npx skills add zitadel/nextgen --full-depth` installs Agent Skills for the CLI, the components and each SDK, and the docs come as `llms.txt` and over MCP. [Agents](https://preview.zitadel.com/docs/get-started/agents)
- **Tests against a real server.** `@zitadel/testing` starts a local Zitadel for Playwright, with seeded users, signed-in pages and virtual passkeys.

### Not there yet

- Password recovery, email or SMS codes, TOTP, email verification and enforced MFA. The default flow covers sign-in and sign-up with passwords, passkeys and social sign-in.
- Social sign-in is OIDC only, and a provider can't be linked to an existing account yet.
- Zitadel doesn't issue OIDC or OAuth tokens to your apps in this preview: apps use its sessions through the SDKs, and the SPA frameworks need a proxy of your own in production.
- Deploying a release to your own domains goes through the API; deploying to preview URLs, rollback and a CLI command for it are still to come.

### Upgrading from 1.0.0-alpha.N

- Install with `@latest`, for the CLI and every SDK; `@alpha` now points at `0.1.0` and stays there. npm sorts `0.1.0` below `1.0.0-alpha.28`, so Renovate and Dependabot won't offer this update: set the `@zitadel/*` versions in your `package.json` to `0.1.0` yourself. The GitHub releases `v1.0.0-alpha.20` to `.28` are now `v0.1.0-alpha.20` to `.28`.
- **Security:** an auth attempt could issue a session after verifying only the user's identifier ([#2211](https://github.com/zitadel/nextgen/pull/2211)). Upgrade the server, then revoke active sessions whose only factor is `identifier`. Step-up sign-in now needs the session's `session_token` as well as its `session_id` ([#2166](https://github.com/zitadel/nextgen/pull/2166)).
- **Breaking:** a deploy that names a primary origin answers `400` with `dep.invalid`; deploy with `targets: ["primary"]` ([#1736](https://github.com/zitadel/nextgen/pull/1736)). Also check the new error codes for schema failures (`req.invalid`, [#1894](https://github.com/zitadel/nextgen/pull/1894)) and over-long passwords (`user.password_policy_violation`, [#2107](https://github.com/zitadel/nextgen/pull/2107)), and how `POST /flow` picks the release by `Origin` ([#2043](https://github.com/zitadel/nextgen/pull/2043)).

Every change since 1.0.0-alpha.28, the last alpha, is in the [release notes on GitHub](https://github.com/zitadel/nextgen/releases/tag/v0.1.0).
