# ADR 091: Date Versions for Event Payloads

> **Status:** Proposed
> **Date:** 2026-11-11
> **Builds on:** [ADR 048](048-wide-events-internal-audit-primitive.md)
> (events and their payloads), [ADR 049](049-events-api-retention-export.md)
> (`GET /events`, retention), [ADR 074](074-preview-releases-on-0x.md)
> (package versions, the changelog) and [ADR 077](077-api-path-prefix.md)
> (`/api/v1`, `Zitadel-Version` as target design).
> **Amends if accepted:** [ADR 077](077-api-path-prefix.md)'s non-goal on the
> versions of outgoing webhook payloads.
> **Related:** ADR 090, proposed apart from this one (project webhooks, the
> first thing to pin a version).

## Context

An event's payload is the contract of `GET /events` and of every webhook
(ADR 090). Its shape comes from the server's code,
and nothing names that shape:

- the `events` table stores a payload and not which shape it has;
- a webhook's receiver is the customer's code, deployed on the customer's
  schedule, while the hosted cloud deploys `main` continuously;
- ADR 077 names a date-based `Zitadel-Version` as target design and decides
  neither it nor the versions of webhook payloads.

So a renamed field reaches every receiver the moment it is deployed.

**In scope:** what a version is and when one is minted; how the server knows
a stored event's shape and sends an older one; how a customer learns which
versions exist and what each changed; how a version relates to package
versions and project releases.

**Not in scope:** the `Zitadel-Version` request header and per-credential
pins, which will take these versions; versions of anything but event
payloads; converting anything while one version exists.

## Decision

### 1. A version is a date

- A version is the date it was minted, `2026-11-11`.
- A new version is minted only for a breaking change to an event's shape: a
  field removed, renamed, retyped or given another meaning.
- A new field and a new event type are not breaking. Receivers ignore fields
  and types they do not know, and the docs say so.
- Retiring an event type keeps to the
  [catalog](../design/api/events-catalog.md)'s Retired process.
- The pull request that breaks a payload mints the date. Its changeset's
  `**Breaking:**` paragraph names it (ADR 074).

### 2. Three versions, three questions

| Version | Example | What it versions | Who moves it |
|---|---|---|---|
| Package | `0.5.0` | the server's, the CLI's and the SDKs' code, released together | us, each release |
| Project release | `rel_…` | the customer's configuration | the customer, on `deploy` |
| Date | `2026-11-11` | the shape of event payloads | us, on a breaking change |

- A package version supports a set of date versions. Upgrading a server adds
  dates and changes no pin.
- The cloud deploys `main`, so a date is live there before the npm release
  that carries it.
- The CLI chooses no version. What it creates takes the server's default.
- A project release is not a pin. It versions configuration, while the
  server's code decides an event's shape; a preview runs another release than
  the primary origins; and two receivers of one project could not upgrade
  apart.

### 3. Which shape a stored event has

The server always writes the newest shape. Every event row records it in
`payload_version`. Rows written before the column count as the first version.
A stored event is never rewritten.

### 4. Sending an older version

A breaking change comes with two functions per event type it touches, kept
beside the payload structs:

- *down* turns the new shape into the one before it. To serve a pin several
  versions back, the server applies each step in turn. It stays for as long as
  the older version is supported.
- *up* turns the old shape into the new one, for rows written before the
  change. Once retention has purged those rows
  ([ADR 049 §2](049-events-api-retention-export.md#2-retention-and-immutability))
  it is deleted.

A reader takes the row, brings it up to the newest shape if it is older, then
down to the version asked for.

- A webhook gains `api_version`, its pin, and is sent that version, named in
  a `Zitadel-Version` header. Create may name the pin and otherwise takes the
  newest version; `PATCH` changes it. Webhooks that exist when this is built
  take the first version.
- `GET /events` answers in the newest version until the request header
  exists, so Logs and a webhook on the newest version agree.
- A server asked for a version it does not know refuses, or for a webhook
  fails the delivery. It never answers in another shape.

Until a second version exists there is one value and no function.

### 5. Finding the versions

- **The spec.** Every field that holds a version is an enum of the supported
  ones, so the console, the CLI's help and the SDKs' types list them.
- **`GET /versions`** answers for the server asked, as a self-hosted one may
  support fewer than the docs list. Any API credential may read it.

  ```json
  { "data": [{ "version": "2026-11-11", "released_at": "2026-11-11", "sunset_at": null }] }
  ```

- **The website's changelog**, which lists breaking changes already
  (ADR 074): one entry per version, naming each change and the event types it
  touches.
- **The SDKs.** A package's event types describe one version, that of the
  spec it was generated from. Each SDK exports that date, and its
  `verifyWebhook` warns when a delivery's `Zitadel-Version` differs.
- A write that names an unsupported version is refused, and the error's
  details list the supported ones.

## Open questions

- **A default per project.** When a second version exists, a webhook added
  to an older project starts on the newest version, unlike its siblings. A
  `default_api_version` on the project would keep them alike. It can be added
  the day before the second version is minted, when every project's default is
  unambiguously the first. Whether a credential's pin wants the same default
  belongs with the request header.
- **How long a version is supported.** `sunset_at` has a place and no rule.
- **Before 1.0.0.** ADR 074 lets a breaking change ride a minor. Whether pins
  are honoured from the first breaking change or only from GA.
- **The spec for older versions.** The spec and the generated webhook pages
  describe the newest version. A customer on an older pin has the changelog
  for the difference until the spec is published per version.

## Consequences

- Every breaking change to a payload costs a *down* function that lives
  until its older version is retired.
- `payload_version` is a column on the busiest table, on all three dialects.
  It is built before the first breaking change, while the table holds one
  shape.
- A receiver keeps working across our deploys, and upgrades when its owner
  changes the pin.

## Rejected alternatives

- **A project release as the pin.** See §2.
- **The package version as the version.** Most releases change no payload,
  and the cloud runs no released version.
- **A new event type for every breaking change**, sent beside the old one
  for a while. It needs no conversion, but a webhook on `*` gets both, and the
  catalog grows a type per change.
- **Storing each event once per version.** It multiplies the busiest table
  to save a function call per read.
- **Versioning by header alone, decided later.** A webhook created without a
  pin would need one guessed for it afterwards.

## Documentation impact

- [ADR 077](077-api-path-prefix.md) gets an amendment note on its non-goal.
- [ADR 048](048-wide-events-internal-audit-primitive.md)'s table gets
  `payload_version`.
- [`conventions.md`](../design/api/conventions.md)'s date-based versioning
  entry and the [glossary](../design/glossary.md) point here.
- The website's changelog gains the entries for versions, and the docs a page
  on what counts as a breaking change.
