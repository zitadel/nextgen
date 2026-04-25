# Licensing

This repository uses a split licensing model that mirrors [zitadel/zitadel](https://github.com/zitadel/zitadel/blob/main/LICENSING.md): the identity server is **AGPL-3.0-only** so that modifications stay in the open, while client-side code that integrates into customer applications is permissively licensed so that consumers do not have to open-source their own apps.

## Defaults

Unless a path-specific override below applies, the contents of this repository are licensed under **GNU Affero General Public License v3.0 only (AGPL-3.0-only)**. The full text is in [LICENSE](LICENSE).

This default covers the Go server binary (`./`, `cmd/`, `internal/`) and the embedded React console SPA at `apps/console/`. The Docker images published to `ghcr.io/zitadel/nextgen` are AGPL-3.0-only as a result; the OCI label `org.opencontainers.image.licenses` reflects this.

## Path-specific overrides — MIT

The following paths are licensed under the **MIT License** so that downstream applications can consume them without AGPL obligations and so third parties can implement against the published contracts:

| Path | Purpose |
|---|---|
| `apps/cli/` | TypeScript developer CLI (`npx zitadel`) |
| `packages/components/` | Web components consumed by customer apps |
| `packages/sdk-core/` | Core TypeScript SDK |
| `packages/sdk-next/` | Next.js SDK |
| Future `packages/sdk-*/` | Additional language/framework SDKs |
| `api/` | OpenAPI specifications and generated code |
| `docs/` | Design documents, ADRs, and other written material |

Each MIT-licensed npm package must:
- declare `"license": "MIT"` in its `package.json`,
- include a `LICENSE` file at the package root containing the MIT text,
- carry an SPDX header in source files where reasonable.

For non-package paths under MIT (`api/`, `docs/`), an SPDX header in source files and a `README` note are sufficient — no separate `LICENSE` file required.

## Contributions

By contributing to this repository, you agree that your contributions are licensed under the same license as the file you are modifying. New code in unmarked locations is contributed under AGPL-3.0-only.

## Why this split?

- **Server (AGPL-3.0-only)**: ensures forks and modified deployments contribute changes back, in line with zitadel's broader commitment to open identity infrastructure.
- **Everything else (MIT)**: integrators ship clients, SDKs, CLI, components, and even API specifications inside proprietary applications. Permissive licensing avoids inadvertent AGPL contagion of their codebases. MIT is the npm ecosystem default and keeps the contributor mental model to two buckets instead of three.

If you need clarity for a specific use case, consult legal counsel — this document describes the licensing scheme but does not constitute legal advice.
