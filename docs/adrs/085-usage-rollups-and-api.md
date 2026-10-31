# ADR 085: The Server Counts Usage Into Rollups and Serves Them

> **Status:** Draft
> **Date:** 2026-10-30
> **Context:** The usage half of
> [ADR 084 §8.3](084-hosted-cloud-business-systems.md#8-what-the-server-needs-all-of-it-generic):
> what the server counts for the hosted cloud's bill and its Settings → Usage
> page, where the counts live, and how they are read.
> **Builds on:** [ADR 041](041-storage-statement-contract-tests.md),
> [ADR 046](046-claim-lifecycle-v2.md),
> [ADR 048](048-wide-events-internal-audit-primitive.md),
> [ADR 049](049-events-api-retention-export.md),
> [ADR 065](065-background-jobs.md), [ADR 075](075-platform-operators.md),
> [ADR 084](084-hosted-cloud-business-systems.md)
> **Amends:** [ADR 049 §2](049-events-api-retention-export.md#2-retention-and-immutability):
> while usage is counted, the purge never deletes an event the projector has
> not counted.
> **Depends on:** [#2551](https://github.com/zitadel/nextgen/pull/2551), which
> tells a reader when no event can still commit with an earlier `created_at`.
> **Implementation state:** §1 to §5 are built, with the purge's wait, the
> console's Usage screen and the cloud's prices on it. `usage_days`
> compaction and `usage.retention` (§6) and the operator feed (§5) are not
> yet, so `report-usage` still reads the cloud's mock.

## Context

ADR 084 §6 bills usage as counts the cloud pulls. An hourly `report-usage`
workflow reads each team's usage for its last complete hours and sends Stripe
one meter event per team, meter and hour. The console's add-on shows the same
counts per project and day on Settings → Usage, priced with the cloud's
catalog. §8.3 asks the server for the counts, and for a way to read them for
the whole deployment. Neither exists yet: the cloud functions answer both from
a mock.

The only record of activity is `events` (ADR 048), and the purge keeps 30 days
of it (ADR 049 §2, `events.retention.window`):

- A month is longer than the window. On October 31, October 1's events are
  already gone, so by the time a month's invoice closes, its active users can
  no longer be counted from events. Last month's can't be counted at all.
- Usage the customer reads back, last month's included, therefore has to
  outlive the events it came from.

The server runs on Postgres, Spanner and SQLite. Each statement has a form for
each dialect, and `stmttest` checks that they behave the same
([ADR 028](028-storage-v2-statements-and-dialects.md), ADR 041).

## Decision

### 1. Meters are the server's; prices are the cloud's

A meter is a count the server keeps per project and hour. Meters are defined
in code, beside the event types in `internal/domain`. Each meter names:

- **Its `name`**, in snake_case. The cloud's catalog uses it as the meter's id,
  and Stripe as its event name.
- **Its kind**, matching the catalog's kinds:
  - `users`: each user counts once a month, in the hour of their first
    matching event that month. Hours therefore add up to days, and days to the
    month's count.
  - `activity`: each matching event counts.
- **The event types it counts**, and, for a `users` meter, which column names
  the user.

The first meter is `monthly_active_users`: the users a `session.established`
event names in its `payload.user_id`. Every `auth.token.issued` that names a
user is minted in the transaction that establishes its session, so counting it
too would add no one. The catalog's other meters follow one at a time.

The server stores no price, allowance or plan. A self-hosted deployment that
bills nothing gets the same counts.

A meter counts from the release that adds it, and nothing older than the
retention window is backfilled: a project's first count reads every event
still stored. A new meter's first month can therefore be partial, so the cloud
prices a new meter from the first of the following month.

### 2. Rollup tables, written only by the projector

```sql
-- Postgres (migration 000039); Spanner and SQLite mirror it.
CREATE TABLE zitadel_nextgen.usage_first_seen (
    project_id  TEXT COLLATE "C" NOT NULL
    , meter     TEXT COLLATE "C" NOT NULL
    , month     TIMESTAMPTZ      NOT NULL    -- UTC, the month's first instant
    , user_id   TEXT COLLATE "C" NOT NULL
    , PRIMARY KEY (project_id, meter, month, user_id)
);

CREATE TABLE zitadel_nextgen.usage_hours (
    project_id  TEXT COLLATE "C" NOT NULL
    , meter     TEXT COLLATE "C" NOT NULL
    , hour      TIMESTAMPTZ      NOT NULL    -- UTC, the hour's start
    , value     BIGINT           NOT NULL
    , PRIMARY KEY (project_id, meter, hour)
);

-- usage_days: the same columns, keyed by UTC day (§6), once compaction lands.

CREATE TABLE zitadel_nextgen.usage_cursors (
    project_id        TEXT COLLATE "C" NOT NULL
        REFERENCES zitadel_nextgen.projects (id) ON DELETE CASCADE
    , counted_before  TIMESTAMPTZ      NOT NULL  -- every earlier event is counted
    , last_event_id   TEXT COLLATE "C" NOT NULL  -- "" when it sits on a bound
    , PRIMARY KEY (project_id)
);
```

`(counted_before, last_event_id)` is also where the next read starts, after
it on `(created_at, id)`. No column is a DATE: Spanner's DATE needs
`civil.Date` in Go, which nothing else in the repo uses.

- **Rows only where something counted.** A row exists only for an hour in
  which something counted. A project's month is therefore at most 31 day rows
  or 744 hour rows per meter.
- **No foreign key on the rollups.** As with `events`, the rollup tables have
  no foreign key to `projects`, so a deleted project's usage stays until it
  ages out. Only its cursor is deleted with it.

### 3. The projector counts each event once

**When it runs.** The projector (`audit.UsageProjector`) runs its own loop,
every `usage.interval`, as the purge does: ADR 065's job table does not exist
yet, and the projector moves onto it with the purge.

- On a server that runs only while it serves a request, a scheduler calls
  `/cron/usage` with `usage.trigger_secret` instead. This works like the
  purge's trigger (ADR 049, amendment of 2026-10-27).
- It walks every project, claimed or not, per project as the shipper does
  (ADR 049 §3), though the shipper walks only claimed ones. Counting unclaimed
  projects means a project claimed mid-month has its whole month counted.

**What it does for each project:**

1. **Reads a batch of settled events.** It reads the project's events of the
   meters' types after its cursor, in `(created_at, id)` order, at most 500,
   with the bound the read is complete to (`ReadUsageEvents`). Each dialect
   knows that bound its own way:
   - **Postgres:** #2551's settled bound, from the locks event writers hold.
   - **Spanner:** the strong read's own timestamp. `created_at` is the commit
     timestamp, so a later commit is stamped later.
   - **SQLite:** the clock, read before the list. An insert never stamps an
     event before its project's `counted_before`, so one whose clock read
     came earlier still lands after the cursor.
2. **Picks the next cursor.**
   - A full batch moves it onto its last event.
   - A short batch moves it to `(bound, "")`, so a quiet project never reads
     the request events behind its last sign-in again.
   - It never moves back, and an idle project's moves only when the bound
     enters another hour: about one write per idle project and hour.
3. **Counts the batch in one transaction.** The transaction does three things:
   - It moves the cursor, by compare-and-set against the one it read
     (`AdvanceUsageCursor`).
   - It inserts the batch's users into `usage_first_seen` where they are not
     there yet.
   - It adds to `usage_hours`, per hour of `created_at`, the users it inserted.
   A batch that names no user only moves the cursor.

**Why every event counts exactly once:**

- A crash rolls the batch back together with its cursor.
- Of two runs that read the same cursor, the second's compare-and-set
  matches no row, so it writes nothing and stops: Postgres makes it wait for
  the first's row lock, Spanner aborts and replays it, SQLite starts it after
  the first commits. A Spanner replay recomputes from values captured before
  the transaction.

**Events a meter can't use.** An event a meter can't read, such as a `users`
event that names no user, counts nothing, and it never stops the projector.

**Which hour an event lands in.** An event counts in the hour of its
`created_at`, not of its `occurred_at`. Path A request events therefore land in
the hour they were flushed, about a second after the request (ADR 049 §1).

**Lost request events.** Path A is best-effort (ADR 048 §3). Request events lost
in a crash are never counted, so an `activity` meter on them can undercount.
The error is in the customer's favor.

### 4. Sealed hours never change

An hour is sealed for a project once the project's `counted_before` has passed
the hour's end. Nothing can be added to a sealed hour, so both the bill and the
page can rely on it.

Each read reports `sealed_through`, the start of the first hour that is not
sealed yet:

- For one project, on that project's read: its `counted_before`, truncated to
  the hour, or null before its first count.
- For the whole deployment, on the operator feed: the earliest hour before
  which any project still has events to count. A project without a cursor
  yet counts as unsealed.

An idle project's cursor moves with the clock, an hour at a time. Only
projects with uncounted events hold `sealed_through` back.

### 5. Two reads, both returning counts only

**Per project.** It is authorized the way `/events` is (ADR 049 §1): the
project's `viewer` relation, with `usage.read` declared as its OAuth scope, as
`events.read` is. Unlike `/events` it has no pre-claim gate: the counts carry
no event content, and a standalone deployment never claims its projects.

```http
GET /usage?project_id=…&from=2026-10-01T00:00:00Z&to=2026-11-01T00:00:00Z&granularity=day
```

```json
{
  "data": [
    { "meter": "monthly_active_users", "start": "2026-10-01T00:00:00Z", "value": 412 }
  ],
  "sealed_through": "2026-10-30T14:00:00Z",
  "team_id": "team_…"
}
```

- **`granularity`** is `day` (a UTC day) or `hour`. `from` and `to` start one,
  at most 31 days apart.
- **`meter`** filters the result and can be repeated.
- **No paging:** it is a bounded report, not a list. A month is at most 744
  hours per meter.
- **Open buckets:** a bucket that starts at or after `sealed_through` may still
  grow.
- **`team_id`** is the team that has claimed the project (ADR 046), or null.
  The cloud prices a project inside its team's bill, and no other API tells it
  which team that is.
- **Who calls it:** the console's Usage screen, for the selected project, and
  the cloud functions, as the signed-in person (ADR 084 §4), for each project
  the person can act on, keeping those whose `team_id` is the team they price.
- **With counting off,** it answers `404 usage.disabled`.

**For the whole deployment, for `report-usage`** (not built yet). This is an
operator path outside the OpenAPI document, as the purge's trigger is. It
answers only requests that carry `usage.read_secret` as a bearer token.

```http
GET /operator/usage?from=…&to=…
```

```json
{
  "data": [
    {
      "project_id": "proj_…",
      "team_id": "team_…",
      "meter": "monthly_active_users",
      "hour": "2026-10-30T13:00:00Z",
      "value": 17
    }
  ],
  "sealed_through": "2026-10-30T14:00:00Z",
  "next_page_token": "…"
}
```

- **Only sealed hours.** The feed lists sealed hours and nothing else.
- **`team_id`** is the team that has claimed the project at the moment the
  feed is read (ADR 046). It is null for an unclaimed project, which bills no
  one.
  - An hour sealed before a claim shows the claiming team when it is read
    again. Whether it is billed is the cloud's decision.
- **How billing uses it:** ADR 084 §6's `report-usage` asks for its last three
  hours and adds up each team's projects.
- **Why a secret:** ADR 084 §8.3 asked for an operator's machine credential.
  ADR 075 allows only users to be operators, and a job is not a user, so the
  feed takes a secret, as the purge's trigger does. It returns ids and counts,
  and no personal data.

### 6. Usage outlives events, and events wait for usage

**How long usage is kept** (not built yet: until it is, every rollup row
stays):

- **First-seen rows.** A month's `usage_first_seen` rows are deleted once the
  following month is sealed. They only decide who counted first.
- **Hours.** A month's hours stay through the following month, while its
  invoice closes. The projector then writes them into `usage_days` and deletes
  them.
- **Days.** Day rows stay for `usage.retention`, 13 months by default, so a
  month can be compared with the same month a year earlier.

**The purge (amends ADR 049 §2).** While `usage.enabled` is on, the purge
doesn't delete a project's events from that project's `counted_before` on
(`DeleteCountedEventsOlderThan`).

- A stalled projector makes `events` grow instead of losing usage. Each run
  logs what it counted, and a failed run logs why; a lag metric is to come.
- ADR 049 §2 keeps export best-effort, and that stays. Usage can't be
  best-effort, because the bill and the customer's history depend on it.
- A project's cursor is deleted with the project, so a deleted project's events
  purge by age alone. Events of a project deleted before the next run are
  never counted.

### 7. Dialects and configuration

- **Dialects.** The design uses plain tables and each dialect's upsert, with no
  triggers and no views. `stmttest` covers counting, sealing, compaction and
  the purge's wait (ADR 041).
- **Spanner.** Keys lead with `project_id`, so Spanner spreads the writes
  across projects.
- **Postgres.** It needs no partitions at first: the rows are small and exist
  only where something counted.
- **Settings.** `usage.enabled` (on by default, self-hosted too),
  `usage.interval` (5 minutes by default) and `usage.trigger_secret`; with the
  feed and compaction, `usage.read_secret` and `usage.retention`.
- **Hosted cloud.** Its Vercel Cron Job calls `/cron/usage` every five minutes,
  with the same `CRON_SECRET` as the purge.

## Consequences

### Positive

- The bill and the usage page read the same sealed counts. What a customer
  sees is what Stripe gets.
- Usage outlives the 30-day window: last month and last year stay readable,
  and billing never races the purge.
- Reads are small and indexed, and none of them aggregates events.
- The same design works on all three dialects, and self-hosted deployments get
  usage numbers too.
- ADR 084's `Directory.usage` and `Directory.usageByDay` ports map onto the
  two reads.

### Negative / Risks

- **Another background job.** It keeps a cursor per project, like the shipper,
  and it can lag. `sealed_through` waits for the slowest project.
- **The purge depends on the projector.** A stalled projector makes `events`
  grow until someone fixes it.
- **Usage lags events.** It trails them by the job interval, so "so far" is a
  few minutes old.
- **Meters count from their release.** A changed definition never recounts the
  past.
- **Lost request events stay uncounted.** Path A request events lost in a
  crash are never counted.

## Rejected alternatives

### Materialized views

1. **Two of the three dialects have none.** Spanner runs a view's query every
   time the view is read, and SQLite has no materialized views at all.
   Postgres alone would need an implementation the other two can't have.
2. **Postgres refreshes the whole view.**
   - `REFRESH MATERIALIZED VIEW` reruns its query over every event in the
     window. `CONCURRENTLY` still recomputes everything, then compares the
     result with the old one.
   - Refreshing only what changed needs an extension. pg_ivm isn't offered by
     PlanetScale. TimescaleDB's continuous aggregates are in its Community
     edition, while PlanetScale ships only the Apache 2 edition.
3. **A refresh forgets what the purge deleted.** That is the retention problem
   described above. Keeping one view per month and no longer refreshing it is
   just a table built the long way round.
4. **Nothing is ever sealed.** A refresh can change any bucket at any time.

### Counting from `/events` in the cloud functions

- Every event would cross the network just to be counted.
- `/events` reaches back only as far as the retention window.
- It is ADR 084 §6's rejected per-event push, in the other direction.

### Counting in the writing transaction

- Every sign-in in a project would update the same hour row, which means lock
  waits on Postgres and aborted transactions on Spanner.
- Path A request events have no transaction to join.
- The first-seen inserts alone could be written there, but the hour counts
  would still need a job.

### Recomputing open hours on every run

Rerunning is safe without a transaction around the cursor, but every run
rescans a busy project's open hours. Moving the cursor in the batch's own
transaction gives the same safety, at the cost of reading only the new events.

### A time-only purge with an alert

It leaves ADR 049 §2 unchanged, but it loses usage whenever the projector
stalls for longer than the window.

## Non-goals

- **Prices, plans, allowances and invoices.** These belong to the cloud (ADR
  084 §6).
- **Quotas and limits** (ADR 084 §8.3). They will read these rollups, but they
  need their own decision.
- **Gauges.** These are the catalog's levels read from state, which need a
  daily snapshot rather than events.
- **Analytics over request events** (the catalog's `observed_users`). This
  wants an analytics store.
- **Backfill** from before a meter ships.

## Open questions

1. **Self-hosted default.** Usage is on by default when self-hosted, so the
   console's Usage screen has something to show. Is a job and a purge that
   waits for it the right default?
2. **The feed's guard.** Is a secret the right guard for the feed, or does
   billing need a machine principal, which ADR 075 rules out today?
3. **What makes a user active.** Once refresh grants mint tokens without a
   new session, does such a token count as activity, or only sign-ins?
4. **Usage before a claim.** The per-project read answers before a claim,
   where `/events` answers nothing (§5). Is that the right line?
5. **Per-project retention.** The catalog's 90- and 400-day retention meters
   imply a purge window per project. The purge's wait works with such a
   window, but the window itself needs a decision.

## Related ADRs

| ADR | Relationship |
|-----|--------------|
| [041 Storage Statement Contract Tests](041-storage-statement-contract-tests.md) | `stmttest` holds the dialects to one behavior |
| [046 Claim Lifecycle v2](046-claim-lifecycle-v2.md) | The claiming team the feed names |
| [048 Wide Events](048-wide-events-internal-audit-primitive.md) | The events counted; Path A's best-effort delivery |
| [049 Events API, Retention, and Export](049-events-api-retention-export.md) | Authorization the per-project read copies; the purge this amends; the shipper's walk |
| [065 Background Jobs](065-background-jobs.md) | The loop the projector runs on |
| [075 Platform Operators](075-platform-operators.md) | Operators are users, so the feed takes a secret |
| [084 Hosted Cloud Business Systems](084-hosted-cloud-business-systems.md) | §6's billing and §8.3's request, which this answers |
