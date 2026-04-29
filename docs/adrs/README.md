# Architecture Decision Records

This directory contains architecture decision records (ADRs) for nextgen.

## Index

| ID | Title | Summary |
|---|---|---|
| [001](001-server-cli-cobra-viper.md) | Standardize Server CLI on Cobra and Viper | Proposes Cobra and Viper as the standard server CLI/configuration stack and captures the open question around presenting backend-specific options like `database.spanner` vs `database.postgres`. |
| [002](002-multi-package-release-strategy.md) | Multi-package Release Strategy | The monorepo releases its Go server binary (via GoReleaser) and TypeScript packages (via changesets) independently, while the console SPA ships embedded in the Go binary rather than as a separate npm artifact. |
| [003](003-create-first-claim-later.md) | Create First, Claim Later | Agents can fully configure a local Zitadel project before any human signup, with account ownership ("claim") deferred to a human handoff step that the CLI surfaces via a `claim_url` but never completes automatically. |
| [004](004-agent-contract-and-agents-md.md) | Agent Contract and AGENTS.md | `apps/cli/AGENTS.md` is the single canonical, generated contract for AI agents, who should invoke the CLI with `--non-interactive --json` and rely on structured `next_commands` rather than prose output. |
| [005](005-public-runtime-private-credentials.md) | Public Runtime and Private Credentials | Browser-rendered auth components receive only public metadata (project ID, issuer, environment), while all secrets remain in server-side or CLI-managed stores to prevent credential leakage. |
| [006](006-web-component-renderer-direction.md) | Web Component Renderer Direction | The long-term auth UI target is a framework-neutral `<zitadel-flow>` web component; the current React/Next shim establishes the same props contract as a forward-compatible placeholder until the web component ships. |
| [007](007-gitops-configuration-surface.md) | GitOps Configuration Surface | Auth configuration is described in repo files (`zitadel.json`, `.zitadel/**`) and pushed to the server via `zitadel plan`/`apply`, making auth changes reviewable and diffable like code. |
| [008](008-users-eav-store.md) | Scalable EAV Storage for User Attributes | User attributes are stored using a partitioned Header/Data/Registry (EAV) pattern designed to support 10M+ users with sub-2ms retrieval and enforced uniqueness scoped to team or globally. |
