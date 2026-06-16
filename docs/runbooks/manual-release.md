# Manual Release Runbook

This repo uses Moon for CI/build orchestration and Changesets for versioning,
changelogs, npm publishing, and package tags.

## Prepare a version PR

1. Make sure every user-visible public package or product change has a
   `.changeset/*.md`.
2. Run the manual `release-prepare` workflow.
3. Review the generated version PR. It should update package versions,
   changelogs, and the private `@zitadel/server-release` record when the server
   product version changes.
4. Merge the version PR only after split CI is green.

## Publish

1. Run `release-publish` from `main` with `dry_run=true`.
2. Confirm the dry run builds server archives, checksums, npm tarballs, and
   Docker metadata.
3. Run `release-publish` again with `dry_run=false`.
4. Verify npm packages, `ghcr.io/zitadel/nextgen:<version>`, the product
   `v<version>` tag, and the GitHub Release.

## Recover

Use `release-recover` for an already-versioned release when local artifacts were
built but a remote publish step failed. Recovery verifies the checked-out
`@zitadel/server-release` version before republishing containers or updating the
GitHub Release.

## Local checks

```sh
moon ci
moon run release:snapshot
moon run release:publish -- --dry-run
```
