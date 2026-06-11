# Release Preview Product Bundle

Use this runbook to publish a `zitadel-preview@0.x.y` product bundle for
external testers. The bundle composes existing artifacts only; it does not
publish npm packages, run GoReleaser, or force component versions into lockstep.

## Inputs

- Preview version, for example `0.1.0`.
- Immutable server image, for example `ghcr.io/zitadel/nextgen:v0.1.0-alpha.3`.
- Exact `@zitadel/cli` npm version.
- Exact SDK npm versions needed by the generated app, starting with
  `@zitadel/sdk-next`.
- Optional release notes file path.

Do not use mutable image tags such as `latest`, `alpha`, `next`, or `canary`.

## Steps

1. Merge the feature and fix PRs that make up the preview.
2. Let `.github/workflows/release-npm.yml` publish the npm prereleases.
3. Run `.github/workflows/release.yml` for the server image.
4. Open the npm package pages or run `npm view <package>@<version> version` to
   confirm every exact npm version exists.
5. Confirm the server image exists, for example:

   ```sh
   docker buildx imagetools inspect ghcr.io/zitadel/nextgen:<tag>
   ```

6. Run `.github/workflows/release-preview.yml` with the collected inputs.
7. Review the draft GitHub Release:
   - title is `ZITADEL Preview <version>`;
   - tag is `zitadel-preview-v<version>`;
   - manifest asset is `zitadel-preview-<version>.json`;
   - component table lists the expected server image and npm versions;
   - tester commands use exact `@zitadel/cli` and `--preview-manifest`.
8. Publish the draft release when the notes and manifest look correct.

## Tester Handout

Send testers the GitHub Release URL and these commands from the release notes:

```sh
npx @zitadel/cli@<exact-cli-version> doctor --preview-manifest <manifest-url>
npx @zitadel/cli@<exact-cli-version> start --preview-manifest <manifest-url>
npx @zitadel/cli@<exact-cli-version> setup --framework next --server local --preview-manifest <manifest-url>
```

If testers cannot access private GitHub Release assets, copy the manifest to a
public URL and use that URL in the commands.

## Failure Checks

- Invalid `preview_version`: use `0.x.y`, for example `0.1.0`.
- Mutable server image: rerun with an immutable tag.
- Missing server image: run the server release first or use the published tag.
- Missing npm package version: wait for `release-npm.yml` or correct the input.
- Wrong generated app dependency: confirm the manifest contains the expected SDK
  package and exact version.
