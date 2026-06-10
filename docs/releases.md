# Releases

Zitadel v5 alpha releases are lockstep preview releases. One version such as
`v5.0.0-alpha.1` represents the tested runtime, CLI, SDKs, components, and
Docker image for that alpha.

The v5 major is intentional: this repository is the next-generation Zitadel
project and may become the successor to the classic Zitadel product released
from `zitadel/zitadel`. Until that decision is final, v5 releases stay alpha
and opt-in.

## Versioning model

- GitHub Releases are named
  `Zitadel next-generation preview v5.0.0-alpha.N`.
- Public npm packages and the private `@zitadel/product` release-note anchor are
  fixed together in Changesets.
- npm package publishes do not create GitHub Releases.
- GoReleaser creates the single draft GitHub Release and uploads runtime
  archives, checksums, metadata, and the Docker image.
- Package changelogs remain the detailed package history. The GitHub Release is
  the readable product entry point.
- SemVer-shaped alpha versions are release coordinates. Breaking changes can
  happen between alpha releases and must be called out in the release notes.
- `release-manifest.json` is attached as a small machine-readable receipt for
  agents; it does not own release policy.

## Changesets

Every user-visible change needs a changeset:

- Package changes mention the affected public package.
- Runtime, API, docs-for-users, and product-level changes mention
  `@zitadel/product`.
- Chores/tests/CI-only changes use an empty changeset.

The repo is in Changesets prerelease mode with the `alpha` dist-tag. The v5
train starts at `5.0.0-alpha.0`; the next Version Packages PR produces
`5.0.0-alpha.1`. Because the release packages are fixed together, any package
or product changeset bumps the whole train.

## Release manager checklist

1. Merge feature/fix PRs with their changesets.
2. Let `.github/workflows/release-npm.yml` open the "Version Packages" PR.
3. Review the Version Packages PR: versions should all be the next
   `5.0.0-alpha.N`, package changelogs should contain the detailed notes, and
   `packages/product/CHANGELOG.md` should summarize product/runtime/API changes
   and known limitations.
4. Merge the Version Packages PR. It publishes the public npm packages under
   the `alpha` dist-tag and does not create GitHub Releases.
5. Run `.github/workflows/release.yml` (`release-zitadel`) with:
   - `version`: the matching tag, for example `v5.0.0-alpha.1`
   - `ref`: the merged Version Packages commit or `main`
   - `dry_run`: `true`
6. Review the generated `release-preview` workflow artifact containing
   `release-notes.md` and `release-manifest.json`.
7. Rerun `release-zitadel` with `dry_run: false`. The workflow creates or
   verifies the `v5.0.0-alpha.N` tag, then GoReleaser creates a draft GitHub
   Release named `Zitadel next-generation preview v5.0.0-alpha.N` and uploads
   `release-manifest.json`.
8. Review and publish the draft GitHub Release.

## Local checks

Validate the lockstep package state before a release:

```sh
node scripts/validate-release-version.mjs --version v5.0.0-alpha.1
```

Generate the same notes that the workflow gives to GoReleaser:

```sh
node scripts/generate-release-notes.mjs \
  --version v5.0.0-alpha.1 \
  --output /tmp/zitadel-release-notes.md
```

Generate the manifest attached to the GitHub Release:

```sh
node scripts/generate-release-manifest.mjs \
  --version v5.0.0-alpha.1 \
  --output /tmp/zitadel-release-manifest.json
```

Run a local GoReleaser snapshot:

```sh
goreleaser release --snapshot --clean --skip=publish,sign \
  --release-notes /tmp/zitadel-release-notes.md
```

## Native CLI distribution

Today the CLI is published through npm as `@zitadel/cli` with the executable
name `zitadel`. A future native CLI publisher can add Homebrew,
curl-installable archives, or non-npm distribution for the same command.

Do not make the server-runtime artifact flow publish a Homebrew `zitadel` formula
that installs the server binary by accident. If GoReleaser is used for native
CLI distribution later, configure it as a CLI publisher for the `zitadel`
command.
