# ADR 023: Lockstep Alpha Release Train

> **Status:** Accepted
> **Date:** 2026-06-11
> **Context:** customer-facing alpha releases for nextgen

## Decision

Publish public nextgen alpha releases as one lockstep train version across the
server image, server binary, CLI, and public npm packages:

```text
0.1.0-alpha.N
```

During the alpha period, this intentionally overrides the independent component
cadence described in [ADR 002](002-multi-package-release-strategy.md). Changesets
remains the version and npm changelog tool, but all public npm packages are in
one fixed group. When the Changesets "Version Packages" PR is merged,
`release-npm.yml` publishes npm first, validates that every public package has
the same alpha version, creates the matching `v<version>` tag, runs GoReleaser
from that tag, and updates one draft GitHub Release named
`ZITADEL Alpha <version>`.

The user-facing release is the GitHub Release for `v<version>`. It contains
tester commands, an npm package table, and GoReleaser server artifacts. Alpha
GitHub Releases are marked as prereleases and are not marked as the latest
release. The server image is published as:

```text
ghcr.io/zitadel/nextgen:<version>
```

Alpha trains do not move the Docker `latest` tag. Only stable, non-prerelease
GoReleaser releases may publish `ghcr.io/zitadel/nextgen:latest`.

The CLI derives the default local runtime image from its own installed version:

```text
@zitadel/cli@0.1.0-alpha.N -> ghcr.io/zitadel/nextgen:0.1.0-alpha.N
```

Local/dev CLI builds and non-alpha versions fall back to
`ghcr.io/zitadel/nextgen:latest`. `--image` and `ZITADEL_LOCAL_IMAGE` remain
advanced overrides.

Generated apps pin SDK dependencies to the exact CLI alpha version. For example,
`@zitadel/cli@0.1.0-alpha.N setup --framework next` writes
`@zitadel/sdk-next: "0.1.0-alpha.N"`.

## Consequences

Positive:

- Testers get the simple Supabase-style command surface:
  `npx @zitadel/cli@alpha start`.
- Bug reports can use an exact reproducible train:
  `npx @zitadel/cli@0.1.0-alpha.N start`.
- Maintainers still use Changesets for npm versioning and GoReleaser for Go
  artifacts, but there is only one public release object.
- Helm charts can later join the same train with chart version and `appVersion`
  equal to the alpha version.

Trade-offs:

- Public alpha packages release together even if only one package changed.
- The alpha train may publish server artifacts for npm-only changes.
- This is a preview-era policy; stable releases can revisit independent
  component cadences once the product line is mature.

## Follow-up

- Decide when to leave the `alpha` prerelease stream and publish stable `latest`
  npm packages.
- Decide whether the server binary/image should be renamed from `nextgen` before
  the eventual stable product line.
- Add Helm chart publishing to the same train once chart publishing exists.
