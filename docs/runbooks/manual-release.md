# Release Runbook

This repo uses Moon for CI/build orchestration, server artifacts, containers,
and the draft GitHub Release shell for `v<version>`. Changesets owns package
versioning, changelogs, npm publishing, and public package tags. A release's
story is a post on the website's changelog, drafted by an agent in a pull
request after the release ([Product notes](#product-notes)).

## Normal release

1. Make sure every change that ships in the release has a `.changeset/*.md`,
   including shipped Go server changes (list `@zitadel/server`); see the
   [changeset decision table](../../.changeset/README.md#decision-table).
2. Merge those changes to `main`.
3. `release-publish` runs the Changesets action and opens or updates the
   generated version PR.
4. Review the generated version PR. It should update package versions,
   changelogs, and the `@zitadel/server` npm runtime version.
5. Merge the version PR only after CI is green.
6. `release-publish` runs automatically from that merge commit on `main`,
   publishes npm packages with Changesets, and pushes the
   `ghcr.io/zitadel/nextgen:<version>` container image. It also creates or
   updates the draft GitHub Release for `v<version>` with generated artifact and
   package facts.
7. Publish the draft GitHub Release as the automation wrote it
   (`gh release edit v<version> --repo zitadel/nextgen --draft=false`), then add
   the release's [changelog post](#product-notes).

## Manual controls

- GitHub renders the `dry_run` workflow input as a checkbox: checked means no
  remote mutations; unchecked allows publishing when the normal or recovery
  gates pass.
- Run `release-publish` manually with `dry_run=true` to build and verify
  server archives, checksums, npm tarballs, Docker metadata, and the generated
  GitHub Release facts block without publishing.
- Run `release-publish` manually with `dry_run=false` only when the current
  `main` commit is still the generated `build: version packages` commit.
- Run `release-publish` manually with `recover_version=<version>` when `main`
  has moved past the generated version commit or any publish-side artifact may
  be missing. Use `dry_run=true` first, then `dry_run=false`.
- Verify npm packages and `ghcr.io/zitadel/nextgen:<version>` after publish.

## Recover

### Pick the mode

| Situation | Workflow | Inputs |
| --- | --- | --- |
| The version commit's own run stopped in its preflight, before publishing anything, and the cause is fixed | that `release-publish` run | none: re-run its failed jobs |
| `main` is still on the generated version commit and the first publish failed before finishing | `release-publish` | `dry_run=true`, then `dry_run=false` |
| `main` has moved past the generated version commit, or the missing artifact surface is unclear | `release-publish` | `recover_version=<version>` with `dry_run=true`, then `dry_run=false` |

A push run publishes the commit it ran for, so re-running its failed jobs
publishes the version commit even after `main` has moved past it:

```sh
gh run rerun <run-id> --repo zitadel/nextgen --failed
```

Prefer that over `recover_version` when a preflight stopped the run:
`recover_version` publishes `main`'s head, which must still carry that
version. Re-run before the next version
PR lands. Publishing the older version after it would move npm's `latest` and
the container's `:latest` back to it.

Use `release-publish` with `recover_version=<version>` for an already-versioned
release when any publish-side artifact may be missing. It verifies the
checked-out `@zitadel/server` version, rebuilds release artifacts, runs
Changesets publish, pushes containers, and updates the draft GitHub Release
facts block.
`changeset publish` only publishes package versions that are not already
present on npm, so the same recovery path is safe when npm packages are already
complete and only Docker needs repair.

```sh
gh workflow run release-publish.yml \
  --repo zitadel/nextgen \
  --ref main \
  -f dry_run=true \
  -f recover_version=0.1.0-alpha.8

gh workflow run release-publish.yml \
  --repo zitadel/nextgen \
  --ref main \
  -f dry_run=false \
  -f recover_version=0.1.0-alpha.8
```

The `recover_version` path deliberately bypasses the normal "latest commit must
be a generated version commit" gate, but it still requires:

- the checked-out `@zitadel/server` version to equal `recover_version`;
- the workflow to run from `main`;
- the normal artifact preflight and snapshot verification to pass.

After the recovery run, verify the public surfaces and draft release shell:

```sh
npm view @zitadel/server@0.1.0-alpha.8 version
npm view @zitadel/sdk-angular@0.1.0-alpha.8 version
docker buildx imagetools inspect ghcr.io/zitadel/nextgen:0.1.0-alpha.8
gh release view v0.1.0-alpha.8 --repo zitadel/nextgen
```

## Product notes

The GitHub Release needs no prose: its generated facts block lists each change
once. The release's story goes on the website's changelog as a post,
`apps/website/changelog/<version>.md`, once the version PR has merged:

1. Have an agent draft it with the `zitadel-changelog-post` skill
   ([`SKILL.md`](../../apps/website/skills/zitadel-changelog-post/SKILL.md)):
   point the agent at that file, or install the skill with
   `npx skills add zitadel/nextgen --skill zitadel-changelog-post`.
2. Review its pull request like any other, and merge it.

The changelog reads the releases from the repository when the site builds:
each release's changes from the packages' `CHANGELOG.md`, with its post above
them ([`releases.ts`](../../apps/website/app/changelog/releases.ts)). Until the
post merges, the release shows its changes alone.

Notes above the generated facts are optional and show on GitHub only. Leave
the block as it is, and edit a draft's notes with `gh release edit`: an API
`PATCH` without `tag_name` resets the draft's tag to `untagged-…`, and
`scripts/release-github.mjs` finds the draft by `tag_name`. `--notes-file`
replaces the whole body, so start from the draft's body:

```sh
gh release view v<version> --repo zitadel/nextgen --json body -q .body > notes.md
gh release edit v<version> --repo zitadel/nextgen --notes-file notes.md
```

The block lists each change once, after the packages it changes. GitHub
rejects release bodies over 125000 characters, so when the body would not fit,
the block omits patch changes, then minor ones, and names the `CHANGELOG.md`
files that hold them; it never omits a breaking change
([`release-github.mjs`](../../scripts/release-github.mjs)). If the
human-written product notes and the breaking changes alone push past the
limit, the facts update fails loudly instead of truncating maintainer prose —
shorten the notes and rerun.

## Local checks

```sh
moon ci
moon run release:snapshot
moon run release:publish -- --dry-run  # from a generated version commit
moon run release:publish -- --dry-run --recover-version 0.1.0-alpha.8
```

## Renumbering the 1.0.0-alpha releases

Once, for [ADR 074](../adrs/074-preview-releases-on-0x.md). Run it from a
checkout of `main`, with `gh` signed in as a maintainer and npm signed in as an
owner of the `@zitadel` packages.

1. Rename the tags and releases before you publish the `v0.1.0` draft: the
   website changelog sorts releases by version, and would list `0.1.0` under
   the old names.

   ```sh
   git fetch --tags origin
   for n in 20 21 22 23 24 25 28; do
     old="v1.0.0-alpha.$n" new="v0.1.0-alpha.$n" notes="$(mktemp)"
     git push origin "$(git rev-parse "$old^{commit}"):refs/tags/$new"
     { printf 'Published to npm and ghcr.io as `%s`.\n\n' "${old#v}"
       gh release view "$old" --repo zitadel/nextgen --json body -q .body; } > "$notes"
     gh release edit "$old" --repo zitadel/nextgen --tag "$new" \
       --title "Zitadel NextGen $new" --notes-file "$notes"
     git push origin ":refs/tags/$old" && git tag -d "$old"
   done
   ```

2. Merge the `build: version packages` PR that releases `0.1.0` soon after
   the PR that adopted ADR 074: until `0.1.0` is on npm, the docs'
   `npx @zitadel/cli@latest` runs the placeholder build.
3. Once `0.1.0` is on npm, deprecate the `1.0.0-alpha` versions and move
   `alpha` to `0.1.0`:

   ```sh
   for pkg in $(node -p "require('./.changeset/config.json').fixed[0].join(' ')"); do
     npm deprecate "$pkg@>=1.0.0-alpha.0 <1.0.0" "Superseded by the 0.x releases: install $pkg@latest"
     npm dist-tag add "$pkg@0.1.0" alpha
   done
   ```

4. Add the [product notes](#product-notes) to the `v0.1.0` draft release and
   publish it; it becomes the repository's latest release.
