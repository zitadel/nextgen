# ADR 002: Lockstep Zitadel v5 Alpha Preview Release Train

> **Status:** Accepted
> **Date:** 2026-04-25 (revised 2026-06-09)
> **Context:** nextgen monorepo release pipelines

## Decision

Release this repository as the lockstep Zitadel v5 alpha preview train.

One version such as `v5.0.0-alpha.1` represents the tested runtime, CLI, SDKs,
components, and Docker image. The v5 major is intentional: this repository is
the next-generation Zitadel project and may become the successor to the classic
Zitadel product released from `zitadel/zitadel`.

Changesets owns npm package versions, package changelogs, and npm publishing.
GoReleaser owns the GitHub Release, runtime archives, checksums, metadata, and
Docker image. The release workflow stitches those tools together by validating
that the manually entered `v5.0.0-alpha.N` tag matches the fixed Changesets
package versions, generating a small `release-manifest.json` receipt for
agents, and passing product notes to GoReleaser.

SemVer-shaped alpha versions are release coordinates. Breaking changes can
happen between alpha releases and must be called out in release notes.

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
- Server/runtime changes get normal Changesets notes through the private
  `@zitadel/product` package.
- The implementation uses familiar tools rather than a manifest-owned workflow:
  Changesets for versions/changelogs/npm and GoReleaser for artifacts.

Trade-offs:

- Packages may bump even when their code did not change.
- A small SDK or CLI fix becomes a new product alpha release by default.
- Release managers still need two tools, but one manual release workflow checks
  that they agree.

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
6. GoReleaser creates a draft GitHub Release named
   `Zitadel next-generation preview v5.0.0-alpha.N`.

## Alternatives considered

- **Independent package releases.** Best for package purity and small fixes, but
  too costly for alpha users who need to know which runtime, CLI, SDK, and
  Docker image belong together.
- **Heavy manifest-centered workflow.** Explicit compatibility sets, but it
  added a custom release layer that felt harder to explain than the problem it
  solved.
- **GoReleaser as the only release owner.** Good for runtime artifacts, but it
  cannot replace Changesets for npm workspace changelogs and package publishing.
- **Changesets as the only release owner.** Good for npm, but it does not build
  Go binaries, Docker images, checksums, or future operator artifacts.
- **Monthly product posts as the release.** Useful communication, but not a
  reliable installable artifact or support boundary.

## Follow-up

- Helm chart publishing is deferred and should join the v5 train when
  implemented.
- Revisit independent package or chart patch releases after stable v5 if the
  support and compatibility story is clear.
- Re-enable npm provenance when the source repository is public.
- Evaluate native CLI distribution for Homebrew/curl once the CLI needs
  non-npm distribution.
