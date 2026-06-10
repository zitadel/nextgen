# ADR 002: Lockstep Zitadel v5 Alpha Release Train

> **Status:** Accepted
> **Date:** 2026-04-25 (revised 2026-06-09)
> **Context:** nextgen monorepo release pipelines

## Decision

Release this repository as the lockstep Zitadel v5 alpha train.

One version such as `v5.0.0-alpha.1` represents the tested runtime, CLI, SDKs,
components, Docker image, and future Helm chart. The v5 major is intentional:
this repository is the next-generation Zitadel project and may become the
successor to the classic Zitadel product released from `zitadel/zitadel`.

Changesets owns npm package versions, package changelogs, and npm publishing.
GoReleaser owns the GitHub Release, runtime archives, checksums, metadata, and
Docker image. The release workflow stitches those tools together by validating
that the manually entered `v5.0.0-alpha.N` tag matches the fixed Changesets
package versions and by passing generated product notes to GoReleaser.

The fixed release train contains:

- `@zitadel/product` (`packages/product/`, private release-note anchor)
- `@zitadel/cli` (`apps/cli/`)
- `@zitadel/api`
- `@zitadel/components`
- `@zitadel/sdk-core`
- `@zitadel/sdk-next`
- `@zitadel/sdk-nuxt`
- `@zitadel/sdk-react`
- `@zitadel/sdk-vue`
- `@zitadel/sdk-angular`

npm package publishes must not create GitHub Releases. Package consumers learn
package-level details from package changelogs and npm package pages. The single
GitHub Release is the product-level entry point.

## Consequences

Positive:

- Users, release managers, and support can talk about one alpha version.
- Compatibility is explicit: one v5 alpha number means one tested bundle.
- GitHub Releases stay readable because npm package publishes stay out of the
  GitHub Release feed.
- Server/runtime/Helm changes get normal Changesets notes through the private
  `@zitadel/product` package.
- The implementation uses familiar tools rather than a custom product manifest
  layer: Changesets for versions/changelogs/npm and GoReleaser for artifacts.

Trade-offs:

- Packages may bump even when their code did not change.
- A small SDK or CLI fix becomes a new product alpha release by default.
- Release managers still need two tools, but one manual release workflow checks
  that they agree.
- Before stable v5, chart-only fixes also become new v5 alpha releases to keep
  compatibility easy to explain.

## Release flow

1. PRs add changesets for user-visible changes.
2. `.github/workflows/release-npm.yml` opens the Changesets "Version Packages"
   PR.
3. Merging that PR bumps every fixed package to the next `5.0.0-alpha.N`,
   updates package changelogs, and publishes public npm packages under the
   `alpha` dist-tag.
4. A release manager runs `.github/workflows/release.yml` (`release-zitadel`)
   with the matching tag, for example `v5.0.0-alpha.1`.
5. The workflow validates lockstep package versions, generates release notes
   from `packages/product/CHANGELOG.md` plus package changelogs, creates or
   verifies the tag, and runs GoReleaser.
6. GoReleaser creates a draft GitHub Release named `Zitadel v5.0.0-alpha.N`.

## Alternatives considered

- **Independent package releases.** Best for package purity and small fixes, but
  too costly for alpha users who need to know which runtime, CLI, SDK, Docker
  image, and future Helm chart belong together.
- **Product manifest workflow.** Explicit compatibility sets, but it added a
  custom release layer that felt harder to explain than the problem it solved.
- **GoReleaser as the only release owner.** Good for runtime artifacts, but it
  cannot replace Changesets for npm workspace changelogs and package publishing.
- **Changesets as the only release owner.** Good for npm, but it does not build
  Go binaries, Docker images, checksums, or future operator artifacts.
- **Monthly product posts as the release.** Useful communication, but not a
  reliable installable artifact or support boundary.

## Follow-up

- Add Helm chart publishing to the `release-zitadel` flow once charts exist.
  During alpha/beta, chart `version` and `appVersion` match the product version.
- Revisit independent package or chart patch releases after stable v5 if the
  support and compatibility story is clear.
- Re-enable npm provenance when the source repository is public.
- Evaluate native CLI distribution for Homebrew/curl once the CLI needs
  non-npm distribution.
