# Architecture Decision Records

This directory contains architecture decision records (ADRs) for nextgen.

## Index

| ID | Title | Summary |
|---|---|---|
| [001](001-server-cli-cobra-viper.md) | Standardize Server Command Surface on Cobra and Viper | Proposes Cobra and Viper as the standard server command/configuration stack; captures open questions around backend-specific option presentation. |
| [002](002-multi-package-release-strategy.md) | Multi-package Release Strategy | GoReleaser for the server binary and embedded console; changesets for npm packages; console ships with the server version, not as a standalone npm package. |
| [003](003-create-first-claim-later.md) | Create First, Claim Later | **Withdrawn.** Pre-claim/claim lifecycle removed from CLI and api-mock pending a server-side `claim` contract. |
| [004](004-agent-contract-and-agents-md.md) | CLI Agent Contract and SKILLS.md | `apps/cli/SKILLS.md` is the CLI agent guidance; agents use `--non-interactive --json` and parse the stable envelope. |
| [005](005-public-runtime-private-credentials.md) | Public Runtime and Private Credentials | Browser UI receives only public runtime metadata; secrets stay in CLI, server, or secret stores. |
| [006](006-web-component-renderer-direction.md) | Web Component Renderer Direction | Target auth UI is a `<zitadel-flow>` web component; React shim prepares the contract until the package ships. |
| [007](007-gitops-configuration-surface.md) | GitOps Configuration Surface | Repo files describe config; `plan`/`apply` validate and upload bundles; local secrets excluded from VCS. |
| [008](008-users-eav-store.md) | Scalable EAV Storage for User Attributes | Partitioned header/EAV/registry model for user attributes at scale with uniqueness enforcement. |
| [009](009-user-json-schema-validation.md) | User JSON Schema Validation | Users validated with instance-stored JSON Schemas; `$schema` URL versioning; no automatic cross-schema migration; upgrades via transactional PUT/PATCH with validation before commit. |
| [010](010-session-auth-attempt-check-model.md) | Session, Auth Attempt, and Check Persistence | ER model for sessions, auth attempts, checks, and authenticators; handoff and step-up; `failure_count` on checks; merged session and auth-attempt repository module. |
| [011](011-resource-identifiers.md) | Resource Identifier Strategy | Ephemeral DB-generated integers vs managed API strings; PostgreSQL and Spanner DDL; `database.Identity` in Go. |
| [012](012-ephemeral-id-api-representation.md) | Ephemeral Identifier API Representation | Placeholder: deferred decision on how ephemeral integer ids appear in HTTP/OpenAPI. |
| [013](013-passkey-gate-contract.md) | Passkey Action Contract | WebAuthn passkey as actions with `ceremony` property (not gates); structured JSON proofs via `ceremony_proof`; conditional UI via autofill; attestation `none` by default. |
| [014](014-design-tokens-and-ui-react-pairs.md) | Design tokens and paired React components | Figma-driven `@zitadel/design-tokens` is the only producer of `--zl-*` variables; Lit atoms and paired React components both read them; console embeds the Lit orchestrator via a tiny `createElement` wrapper, no `@lit/react`. |
| [015](015-shared-component-styles.md) | Shared component styles | `@zitadel/shared-component-styles` owns `.zr-*` surface CSS for Lit/React pairs; opt-in per `pairs.json`; Lit adds thin `lit/*-host.css` for shadow-only rules. |
| [016](016-global-api-initializer.md) | Global SDK Configuration | Write-once `configureZitadel()` sets app-wide config (`apiBase`, `projectId`, `sessionExchangePath`) once at startup; web components read from shared config, attributes become optional overrides. |
| [017](017-flow-engine-auth-attempt-dispatch.md) | Flow Engine Auth-Attempt Dispatch for Signin vs Signup | **Draft.** How a flow step opts in/out of identifier resolution and credential verification; explicit step property + writer manifest preferred over implicit `user_not_found`-transition reading; SSO refinements. |
| [018](018-widget-owned-locale-resolution.md) | Widget-owned Locale Resolution | `<zitadel-login>` auto-detects language from `navigator.language`; `lang` attribute and `locales` map enable explicit control and partial overrides; SDKs do not perform server-side language detection. |
| [019](019-captcha-gate-and-bot-signals.md) | Captcha Gate Contract & Bot-Detection Signals | Captcha is the one gate kind: in-flow provider gate (built-in Altcha + BYO third-party keys) verified via auth_attempts; edge/platform verdict (Vercel/Cloudflare) carried as an authenticated inline header from the SDK proxy, trusted via the project secret. |
| [020](020-credentials-out-of-user-schema.md) | Credentials Out of the User Schema | User schemas describe attributes only; credentials live in dedicated credential storage and are referenced by flow steps through reserved auth-method syntax. |
| [021](021-ordered-arrays-for-step-fields-actions-gates.md) | Ordered Arrays for Step Fields, Actions, and Gates | Runtime and definition step payloads serialize `fields`/`actions`/`gates` as ordered arrays of `{name, ...}` entries instead of name-keyed dicts; `transitions` stays a dict; default Liquid template keeps keyed lookups via a render-local `*_by_name` map. |
| [022](022-user-team-lifecycle-ownership.md) | User, Team, Membership, and Lifecycle Ownership | Users are project-scoped identities; memberships attach users to teams; lifecycle ownership is explicit and configurable; delete operations deactivate/tombstone before purge. |
