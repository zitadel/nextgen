# Agent Instructions — `packages/`

Rules for the packages without an `AGENTS.md` of their own: the SDKs
(`packages/sdk-*`), `packages/api` and `packages/config`.

## The SDKs (`packages/sdk-*`)

`sdk-core` plus one package per framework. Every one is public, listed in
`PUBLIC_RELEASE_PACKAGES` and in the changesets `fixed` group: every observable
change needs a changeset, and the whole train versions together.

- **`sdk-core` is the shared contract**: JWT verification (`verifyJwt`),
  middleware primitives, runtime resolution, and the `ZitadelAuthSession` /
  `AuthResult` types the SDKs re-export through `@zitadel/sdk-core/types`.
  Change a shared type there; never fork it into a framework package.
- **Exports are consumer contract**: removing or renaming an `exports` entry
  (`/server`, `/client`, `/types`, …) is a breaking change, and an addition
  needs a changeset. Never deep-import between SDKs; use their published
  entry points.
- **Framework runtimes are `peerDependencies`**, never `dependencies`: an SDK
  never pins its host framework. `src/contract.spec.ts` in `sdk-core` checks
  each README lists its peers.
- **TypeScript floor**: consumers need TypeScript ≥ 5.0, because the entry
  points use `export type *`. This is the one statement of it; READMEs link
  here.
- **Name a server entry after its framework, and say why.** A meta-framework
  SDK exposes the entry its framework asks for under the framework's own term
  (`createZitadelHandle` for SvelteKit's `handle`, `zitadelMiddleware` for the
  function Next.js calls), and a name that starts with `create` is a factory
  that returns the handler. Write the reason in the `public-api.json` entry,
  in the TSDoc of the function and in [ADR 090](../docs/adrs/090-sdk-public-api-standard.md).
- **Reach the API package only through `sdk-core`.** An SDK imports
  `@zitadel/sdk-core/config`, never `@zitadel/api`, and a name an app can see is
  declared by hand in `sdk-core`, never re-exported from the generated client.
- **Never put the codename "nextgen" in a public name, header, configuration
  key or text.** Use Zitadel. The one exception is the `/__nextgen` proxy path,
  which the server also knows.
- **Keep each package's build tool** (its `build` script). `sdk-next` builds
  per file with `tsc` because bundlers merge `"use client"` modules into shared
  chunks and strip the directive. Never unify the builds without re-testing
  the App Router client/server split.
- **The same-origin proxy is the shared concept**: every SDK fronts the API
  through `/__nextgen/*` on the app's own origin
  ([ADR 036](../docs/adrs/036-api-credential-planes.md), ADR 005). Server SDKs
  implement it; SPA SDKs document a dev/deploy proxy (production guidance:
  [#560](https://github.com/zitadel/nextgen/issues/560)).
- **Edge entries are tested in the edge runtime**: an SDK entry that claims
  edge support has an `edge` project (`edgeProject()` in `@zitadel/vitest-config`,
  Vercel's `edge-runtime` VM) that runs only its edge specs. It fails at
  config load if none exists. Every edge project resolves with `workerd`, the
  condition Wrangler adds for Cloudflare Workers. A package adds a condition
  only where what it loads needs one: `react-server` and `edge-light` for
  Next, whose bundler adds both, and `worker` for Solid, which ships its server
  build under that name. Each carries a one-line comment saying why. Add an
  edge project only where the README claims edge, and leave Node-only entries
  out.
  An edge spec is named after its entry, `<entry>.edge.<spec|test>.<ext>`,
  sits where the package keeps the spec of that entry, uses the suffix of the
  package's own tests, and imports the built package by its name, as a
  consumer's bundler resolves it, never the source. It needs the package's
  `build` before it typechecks or runs.
  Every edge project declaration reads the same; the contract spec in
  `sdk-core` checks it.
- **Write shared cases once**, in `@zitadel/server-sdk-contract` or
  `@zitadel/client-sdk-contract`; an SDK's spec holds its glue and own cases.
- **One Agent Skill per framework SDK**, at `<pkg>/skills/<name>/SKILL.md`,
  plus `skills/zitadel-components/SKILL.md` for `@zitadel/components`; the
  top-level `skills/zitadel` routes to them. A new framework SDK adds its
  skill with the same sections and structure as the others.
- **Skills are discover-first**: they teach the integration pattern and send
  the reader to the package's README and types for props, exports and APIs,
  never listing them. A changed property updates the README or types; edit a
  skill only when the pattern changes.

### Documenting an SDK

The reference of every SDK is built from its doc comments, and a coding agent
may have nothing else to read. Rules for those comments:

- **Write every doc comment as a multi-line block**, never `/** text */`
  on one line, for each export, property, parameter, prop and event.
- **Say what it is, why it exists, when to use it and when not to,** what it
  does when unset or invalid, which option wins, and what happens on the server,
  on the edge and while hydrating.
- **Put the caveats from the history in the comment, in words.** Read the
  commits of the symbol (`git log -S'<name>'`); never cite an issue, pull
  request or commit number.
- **Give every exported function, component, hook and options type an
  `@example`** that uses real imports and real prop names.
- **State only what you verified in the code.** Unsure: leave it out and list
  the symbol as "reason unknown" in the pull request.
- **Document a property that `sdk-core` defines once, in `sdk-core`.** An SDK
  documents only what is local to it, and links the rest with `{@link}`.
- **Link a name only where every SDK that shows the comment exports it.**
  Otherwise write it as a plain literal; TypeDoc fails on a dead link.
- **Build the references with `pnpm run docs:api`** at the root. It must print
  no warning. Each SDK's `typedoc.json` differs from the others only in its
  `name` and `entryPoints` (Svelte also in `tsconfig`, because TypeDoc cannot
  read `.svelte`); shared options live in the root `typedoc.base.json`.
- **Describe a change to an SDK's exports in its `public-api.json`** and in
  [ADR 090](../docs/adrs/090-sdk-public-api-standard.md), and name the new
  entry after its framework with the reason, as described above.

`sdk-core` has rules of its own: [`sdk-core/AGENTS.md`](sdk-core/AGENTS.md).

## `packages/api`

The generated TypeScript client: orval output under `src/generated/`.
Regenerate it, never hand-edit it; the source is
[`apps/api/api/openapi/`](../apps/api/api/openapi/AGENTS.md). The runtime helpers in
`src/runtime/` (`configureZitadel()` from `@zitadel/api/config`, proxy-path
handling) are hand-written and the primary consumer surface.

## `packages/config`

Versioned local config schemas and defaults. The defaults are product:
`defaults/README-*.md` ship to npm and are copied into customer projects as
`.zitadel/{schemas,flows,branding}/README.md` (`src/readmes.ts`), so an edit
there is customer-facing (changeset, `fix:`/`feat:`, not `docs:`).
`defaults/default-login.json` is the authority for flow step shape; the
fixture-diff rule is in [`packages/api-mock/AGENTS.md`](api-mock/AGENTS.md).
