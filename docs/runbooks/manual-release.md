# Release Runbook

This repo uses Moon for CI/build orchestration, server artifacts, and the
product GitHub Release. Changesets owns package versioning, changelogs, npm
publishing, and public package tags.

## Normal release

1. Make sure every user-visible public package or product change has a
   `.changeset/*.md`.
2. Merge those changes to `main`.
3. `release-prepare` runs automatically, validates pending changesets, and
   opens or updates the generated version PR.
4. Review the generated version PR. It should update package versions,
   changelogs, and the `@zitadel/server` npm runtime version. The version PR
   should not create the product GitHub Release; `release-publish` does that
   from the reviewed fixed package version.
5. Merge the version PR only after CI is green.
6. `release-publish` runs automatically from that merge commit on `main`,
   publishes npm packages, pushes containers, creates the product tag, and
   creates or updates the GitHub Release.

## Manual controls

- Run `release-prepare` manually when automation needs to be retried. It
  no-ops when there are no pending `.changeset/*.md` files.
- Run `release-publish` manually with `dry_run=true` to build and verify server
  archives, checksums, npm tarballs, and Docker metadata without publishing.
- Run `release-publish` manually with `dry_run=false` only to retry a publish
  from the current `main` version commit.
- Verify npm packages, `ghcr.io/zitadel/nextgen:<version>`, the product
  `v<version>` tag, and the GitHub Release after publish.

## Recover

Use `release-recover` for an already-versioned release when local artifacts were
built but a remote publish step failed. Recovery verifies the checked-out
`@zitadel/server` version before republishing containers or updating the GitHub
Release.

## Local checks

```sh
moon ci
moon run release:snapshot
moon run release:publish -- --dry-run
```
