---
name: zitadel-changelog-entries
description: >-
  Draft entries for the Zitadel preview's changelog
  (preview.zitadel.com/changelog): one Markdown file per notable change,
  apps/website/changelog/<slug>.md in the zitadel/nextgen repository, opened as
  a pull request. Use when asked to write, draft or update changelog entries,
  for a release or for changes that just landed on the cloud.
metadata:
  internal: true
---

# Changelog entries

The changelog tells people what they can do now, one entry per notable
change; the GitHub Releases keep every change of every version. The cloud runs
`main`, so a change to the server, the API or the console is live on
preview.zitadel.com when it merges, and the CLI, the SDKs, the login
components and a self-hosted server get it with the release that ships it.

`metadata.internal` keeps this skill out of `npx skills add zitadel/nextgen`,
which installs the users' skills.

## Pick the changes

1. What to cover: a release (its `## 0.2.0` sections in the packages'
   `CHANGELOG.md`, or `gh release view v0.2.0 --repo zitadel/nextgen`), or what
   has merged since the newest entry (the pending `.changeset/*.md`, and
   `gh pr list --repo zitadel/nextgen --state merged --search "merged:>2026-10-21"`).
2. Skip a pull request an entry already names in its `pulls`:
   `grep -l 2187 apps/website/changelog/*.md`.
3. Pick what a user notices: something they can do now, a fix they could have
   hit, a security fix, anything they must act on. Fold related pull requests
   into one entry; leave small fixes to the GitHub Release.
4. Read each pick's pull request (`gh pr view <number>`), its changeset, and
   the docs page that covers it (`apps/docs/content/docs/`).

## Write

One file per entry, `apps/website/changelog/<slug>.md`. The slug names its
page, `/changelog/<slug>`; never rename a published one.

```md
---
title: Deploy a release to preview URLs
summary: A sentence or two of plain text, for the index and the feed.
date: 2026-10-24T14:24Z
cloud: true
pulls: [2312, 2340]
---

What a user can do now and how, in a paragraph or two, then details as a list.

[The guide](https://preview.zitadel.com/docs/…)
```

- `date` is when it landed, in UTC: its pull request's merge
  (`gh pr view <number> --json mergedAt`) when it is live on the cloud, the
  npm publish (`npm view @zitadel/cli time --json`) when it needs a release.
  The day alone works too; the time orders a day's entries.
- `cloud: true` when it was live on preview.zitadel.com from `date`.
- `pulls` lists the pull requests that shipped it. The site shows the release
  that carries all of them, and "Not released yet" until one does, so an
  entry written before its release needs no change after it.
- The front matter holds only these fields, one `field: value` a line. Wrap a
  value that contains `: ` or starts with a quote in double quotes, as in
  JSON. The build fails on anything else.
- The title says what a user can do, or what changed for them: "Call any API
  operation from the CLI".
- A breaking change says what breaks and what to do, in a paragraph that
  starts with `**Breaking:**`.
- Write as `.changeset/README.md` asks of a summary: the outcome first, the
  surface a user touches, no internals or ADR numbers. Claim nothing the
  changes, their pull requests or the docs do not say.
- Write Markdown only; the website drops HTML. Start headings at `##`, under
  the entry's title. Link pull requests in full,
  `[#123](https://github.com/zitadel/nextgen/pull/123)`, and docs pages as
  `https://preview.zitadel.com/docs/…`.

## Check and open the pull request

```sh
moon run website:test website:build
moon run website:start   # /changelog and /changelog/<slug> on port 3004
```

Commit only the entries, on a branch from `main`, and open a pull request
titled `build(deploy): add changelog entries for <what they cover>`, without a
changeset.
