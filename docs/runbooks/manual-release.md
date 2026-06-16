# Release Runbook

This repo uses Moon for CI/build orchestration, server artifacts, and the
product GitHub Release. Changesets owns package versioning, changelogs, npm
publishing, and public package tags.

## Normal release

1. Make sure every user-visible public package or product change has a
   `.changeset/*.md`.
2. Merge those changes to `main`.
3. `release-publish` runs the Changesets action and opens or updates the
   generated version PR.
4. Review the generated version PR. It should update package versions,
   changelogs, and the `@zitadel/server` npm runtime version. The version PR
   should not create the product GitHub Release; `release-publish` does that
   from the reviewed fixed package version.
5. Merge the version PR only after CI is green.
6. `release-publish` runs automatically from that merge commit on `main`,
   publishes npm packages, pushes containers, creates the product tag, and
   creates or updates the GitHub Release.

## Manual controls

- Run `release-publish` manually with `dry_run=true` to build and verify server
  archives, checksums, npm tarballs, and Docker metadata without publishing.
- Run `release-publish` manually with `dry_run=false` only to retry a publish
  while the current `main` commit is still the generated version commit.
- Run `release-publish` manually with `recover_version=<version>` when a later
  release-infrastructure fix is needed and npm publishing may not have
  completed. Use `dry_run=true` first, then `dry_run=false`.
- Use `release-recover` only when npm publishing is already handled and the
  remaining recovery is container or product GitHub Release state.
- Verify npm packages, `ghcr.io/zitadel/nextgen:<version>`, the product
  `v<version>` tag, and the GitHub Release after publish.

## Recover

Use `release-publish` with `recover_version=<version>` for an already-versioned
release when npm publishing may not have completed. It verifies the checked-out
`@zitadel/server` version, rebuilds release artifacts, runs Changesets publish,
and then pushes the product tag, containers, and GitHub Release.

Use `release-recover` only after npm publishing is already complete. It verifies
the checked-out `@zitadel/server` version before republishing containers or
updating the GitHub Release.

## Local checks

```sh
moon ci
moon run release:snapshot
moon run release:publish -- --dry-run  # from a generated version commit
moon run release:publish -- --dry-run --recover-version 0.1.0-alpha.8
```
