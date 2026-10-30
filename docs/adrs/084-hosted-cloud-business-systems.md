# ADR 084: The Hosted Cloud's Business Systems Run Beside the Server

> **Status:** Proposed (scaffolded: Zitadel's reads are live, Stripe and
> HubSpot answer from mocks; open questions 1 to 4 decided 2026-10-29;
> HubSpot's records and email subscriptions decided 2026-10-30)
> **Date:** 2026-10-29
> **Context:** What the hosted cloud needs because we sell Zitadel (sign-up,
> bot checks on its own sign-in, support, CRM and marketing consent, pricing
> and billing), where each piece runs, and what the server has to gain for
> it. None of it may reach the server or the console a self-hoster runs.
> **Related:** [Console ADR 0006](../../apps/console/docs/adrs/0006-cloud-addon.md)
> (the console's add-on, amended here),
> [ADR 019](019-captcha-gate-and-bot-signals.md),
> [ADR 046](046-claim-lifecycle-v2.md),
> [ADR 049](049-events-api-retention-export.md),
> [ADR 053](053-cross-project-principals.md),
> [ADR 075](075-platform-operators.md),
> [ADR 078](078-abuse-prevention-in-layers.md) (§5 amended here),
> [ADR 079](079-release-confidence.md)

## Context

### What exists

- One Vercel project serves one origin: the Go `server`, the `console`
  (with the cloud's add-on, Console ADR 0006), `docs`, `website` and
  `schemas` ([`vercel.json`](../../vercel.json)). The server answers every
  path the others do not.
- Sign-up exists, nobody can find it. The platform project's flow has a
  `register` purpose (email, password, `create_user`), the console's login
  links to it, and the first session exchange creates the person's personal
  team (`internal/service/personal_team.go`). The website links nowhere.
- The platform project (`proj_platform`) is not a project like a customer's:
  it is bootstrapped in code with no project secret and is never claimed.
  - Its user schema and flow cannot be changed through the API, whose writes
    take a project secret. A terms checkbox or a marketing opt-in cannot be
    added the way a customer adds one (a `const: true` boolean, an optional
    boolean in the `register` step's `fields`).
  - `GET /events` answers it nothing, and the export ships only claimed
    projects, so the cloud cannot read its own sign-ups. The export's shipper
    runs on an in-process ticker, which a Vercel Function does not keep
    alive (ADR 049).
- Zitadel sends no email. Nobody verifies the address a person signs up
  with.
- Nothing counts usage, and nothing limits it: no plan, quota or limit. The
  only machine credential is a project secret, which reaches its own project
  only; platform operators are human sessions (ADR 075).
- A team has a name and no metadata. Its active members are all equal: there
  are no team roles.
- No Stripe, HubSpot, queue or workflow code exists. ADR 078 §5 keeps the
  cloud's login on Altcha and names BotID "an option" that needs a JavaScript
  function in front of the Go service.

### What the cloud needs, in this order

1. Sign-up, without billing or support.
2. BotID on its sign-in and sign-up.
3. Support.
4. Pricing and billing.

Every person and team also needs a record in the CRM, and marketing email
needs a legal basis.

### Two proposals this answers

- Show the cloud's screens from the console and hide them behind a cloud
  build flag. Console ADR 0006 takes the shape (pages of their own, an entry
  only where they exist) and keeps the code out of the console.
- Let Zitadel put events on a queue that a worker sends to Stripe, with
  retries. §2 and §6 keep the retries and drop the per-event push.

## Decision

### 1. The cloud is a customer of Zitadel

What exists only because we sell Zitadel runs beside the server, in three
places:

| Place | Holds | Ships in |
|---|---|---|
| [`apps/cloud-console`](../../apps/cloud-console/AGENTS.md) | the screens (Billing, Support, Email), BotID's client, the provisioning trigger | the cloud's console build (Console ADR 0006) |
| [`apps/cloud-functions`](../../apps/cloud-functions/AGENTS.md) | the add-on's RPC, the sign-in check, webhooks, crons, workflows | the cloud's `cloud-functions` service |
| Stripe and HubSpot | money; the relationship, tickets and subscriptions | — |

- The server gains only what any customer could use, and the cloud uses it
  as a customer would. A gap the cloud hits is one every customer has, so it
  closes in general (§8), never as a platform-project case.
- Zitadel holds identity, teams and projects, and what a person ticked when
  signing up. Stripe holds money, HubSpot the relationship. There is no store
  of our own: Stripe customers carry `zitadel_team_id`, HubSpot contacts
  `zitadel_user_id` and deals `zitadel_team_id`, and each record is found by
  them.

### 2. One backend service: functions for answers, workflows for the rest

`apps/cloud-functions` is a Next.js app of route handlers, no pages, deployed
as the service `cloud-functions` and routed `/cloud/(.*)` ahead of the
server's catch-all.

| Path | What | Who may call it |
|---|---|---|
| `/cloud/api/*` | the add-on's RPC (`src/contract.ts`) | the console's session (§4) |
| `/cloud/zitadel/*` | the sign-in widget's calls, forwarded to the server after the bot check (§5) | anyone, as the server's own paths |
| `/cloud/hooks/stripe` | Stripe's webhooks | Stripe's signature |
| `/cloud/cron/*` | Vercel Cron | `CRON_SECRET` |

- **A function answers what a person waits for**: reading billing, opening
  Checkout, filing a ticket. It calls Stripe or HubSpot and answers.
- **A workflow does everything else**: provisioning, usage, entitlements,
  erasure (`src/workflows/`, Vercel's Workflow SDK, which runs on Vercel
  Queues).
  - A step retries on a throw (three times by default), waits on
    `RetryableError` (a rate limit) and stops on `FatalError` (a refusal).
  - Stripe's idempotency key is the step's id, so a retried step never
    creates or charges twice.
  - A run that gives up is visible in Observability → Workflows.
- **No queue of our own.** Workflow is built on Queues. A raw topic
  (`@vercel/queue`) comes in when something needs a buffer a workflow run is
  not; nothing does. `vercel dev` cannot run a queue consumer declared inside
  a service yet, while Workflow's local world runs in `next dev`.
- **Next.js** because it is in the catalog and is Workflow's and BotID's
  first-class host: the Workflow SDK ships an integration for Next.js and
  runs Express, Hono or Fastify only inside Nitro, whose integration is
  beta. Only four route files and `next.config.ts` know the host; the ports,
  routes, workflows and sign-in check take a web `Request`.
- **Ports.** `src/ports.ts` names the three systems (`Directory`, `Billing`,
  `Crm`); a route or a workflow names a port, never a vendor SDK. The
  `Directory` reads the person and their teams live; mocks answer the rest
  (§9).

### 3. Sign-up (priority 1)

- Sign-up stays the platform project's own `register` purpose in the
  console's login. Its page, `/console/signup` (the widget opened on
  `register`), is the add-on's, a signed-out screen (Console ADR 0006 §2): a
  self-hosted console signs in to the deployment's own project, where a
  sign-up page would make accounts for the app's users in its management UI.
- **Public sign-up waits for email verification** (decided 2026-10-29). Until
  §8.2 lands, nothing links to `/console/signup`, which is the address to
  show the flow, and the website gets no "Sign up" link. Account creation
  stays reachable as today, from the login page's "Sign up" link and from
  claim, since a CLI user needs an account to claim a project.
- **Every new person gets a team, and can add more.** The server already
  creates a personal team on the first session (`personal_team.go`). Two
  things are missing:
  - It is named `Personal <hash>`, because a team's name is unique within its
    project, and every customer's team lives in the platform project. The
    team should be named after the person ("Florian's team"), which needs
    §8.5.
  - Teams in the platform project are accounts, and the console does not show
    them yet (Console ADR 0005 §3). Adding a team, switching between them, and
    choosing the team a claim lands in are Console ADR 0005 §4's open question.
    That question is now due, because billing is per team.

  Each added team is provisioned like the first (Stripe customer, HubSpot
  deal); today's trigger picks it up on the next signed-in page.
- What sign-up asks for is the platform project's configuration, kept where
  a customer keeps theirs: a `.zitadel/` folder in `apps/cloud`, applied with
  `zitadel apply`. It adds one field to the `register` step: a required terms
  checkbox (`const: true`). This needs §8.1. Product news needs no checkbox
  (§7), but the sign-up page says that it comes and how to leave it.
- **Provisioning**, a workflow per system (`provision-crm`,
  `provision-billing`), so neither system's failure holds up the other, gives
  each new person, as HubSpot models it natively and the legacy cloud does:
  - a HubSpot contact keyed by `zitadel_user_id`. A contact HubSpot already
    has for the email, from a form or the legacy cloud, takes the id rather
    than getting a second;
  - the newsletter and security subscriptions of §7;
  - a deal for each team, keyed by `zitadel_team_id`, with the contact on it.
    HubSpot makes the company itself, from the email domain ("Create and
    associate companies with contacts"), so a personal team never becomes a
    company;
  - a Stripe customer for each team, with no subscription. Stripe advises
    creating the customer at sign-up.

  Every step finds what an earlier attempt made, since HubSpot has no
  idempotency key, and returns the calls it made, which the run shows.
  Sign-up never waits on Stripe or HubSpot.
- **Today's trigger.** The add-on calls `POST /cloud/api/account/ensure` on
  the first signed-in page. The function starts `provision-billing` unless
  every team of the person's already has a Stripe customer, and
  `provision-crm` once per instance, whose lookups find what exists: HubSpot
  never waits on Stripe's answer.
- **The target trigger.** A cron route reads the platform project's
  `GET /events` (`user.created`, `team.created`) for the last minutes, with
  the project secret §8.1 gives the cloud, as a customer would read theirs.
  This also catches people who never open the console. The workflows are
  the same either way.
- **No email verification exists.** Until it does, every contact is
  unverified, no marketing email goes to an address nobody verified, and
  public sign-up waits for §5 and ADR 078's guards. Verification is §8.2.

### 4. The RPC trusts the console's session and nothing else

- The session cookie (`__Host-zitadel_session`, ADR 083; `Path=/`, `SameSite=Lax`) reaches
  `/cloud/api/*` on the same origin. The function forwards it to Zitadel
  (`GET /sessions/me`, `GET /users/me`, `GET /users/me/teams`) to learn who
  the person is and which teams they actively belong to. It keeps no session
  of its own.
- A call that changes something must come from the cloud's own `Origin` and
  send JSON. This takes the place of Zitadel's CSRF token (ADR 053 §5).
- A team is always one Zitadel lists for the caller, never one the request
  only names. Until teams have roles (§8.4), every active member may see and
  manage a team's billing (decided 2026-10-29).
- Card data never passes through the console or the functions: Checkout and
  the Customer Portal are Stripe's pages.

### 5. BotID on the cloud's sign-in and sign-up (priority 2)

- The add-on contract gains `signInApiBase`: where the sign-in widget (login,
  sign-up, claim) sends its calls. The cloud's add-on sets it to
  `/cloud/zitadel`, and starts BotID's client to protect the widget's two
  flow writes, `POST /flow` and `POST /flow/{id}/submit`, beneath that base.
  Every other console call stays direct.
- `cloud-functions` forwards everything beneath `/cloud/zitadel/` to the
  server unchanged (cookies, `Origin`, body), after `checkBotId()` on those
  two writes. This is the JavaScript function in front of the Go service that
  ADR 078 §5 leaves open, and the edge signal of ADR 019: the cloud's console
  is a customer app on Vercel.
- **A bad verdict** (`isBot` and not a verified bot) is refused with `403
  auth.bot_suspected` for now, because the server does not read a risk signal
  yet. That is a block, and ADR 078 §5 says verdicts are signals, never
  blocks. Once ADR 019's runtime reads `X-Zitadel-Risk-Signal`, the function
  forwards the verdict in it, under the origin-scoped secret, and stops
  refusing (decided 2026-10-29).
- Basic checks only, which are free. Deep Analysis (US$1 per 1,000 checks on
  Pro) is a switch for an attack.
- The verdict cannot be enforced anywhere else. `checkBotId()` needs a
  function's request context: Routing Middleware cannot call it, a service
  cannot have middleware, and no firewall rule reads it.

### 6. Pricing and billing (priority 4)

- **Stripe Billing Meters.** One `sum` meter per metric, the first being
  `monthly_active_users`. Stripe now steers new usage-based billing to
  Metronome. Meters stay supported, work with Checkout and the Customer
  Portal, and are enough for one metric. If pricing outgrows them, only the
  `Billing` port changes.
- **Usage is pulled as counts, never pushed per event.**
  - An hourly cron workflow (`report-usage`) reads each team's usage for the
    last complete hours from Zitadel (§8.3).
  - It sends one meter event per team, metric and hour, with `identifier`
    `team:metric:hour`.
  - Each run sends the last three hours again, and Stripe counts an
    identifier once for at least 24 hours. A skipped or doubled cron run
    therefore changes nothing.
  - MAU becomes a sum: an hour's count is the users whose first activity of
    the month falls in it, so the month's events add up to its MAU.
  - Stripe's grace period goes to 24 hours, so a late hour still reaches its
    invoice.
  - Why not one queue message per event: every sign-in would become a
    message when billing needs one count, and the server would carry Vercel's
    queue client and the outbox behind it. A count can be read again safely.
- **Plans.**
  - Free: monthly active users up to the included amount, no card.
  - Pro: a base fee plus a graduated metered price, with the included amount
    at 0.

  A team gets a subscription when an admin chooses Pro in Checkout, and none
  before (decided 2026-10-29): until then its usage is metered on its
  customer and shown, never billed.
- **Entitlements.** Stripe's `customer.subscription.*` and `invoice.*`
  webhooks are checked by signature and start `sync-entitlements`. It reads
  the subscription's state at that moment, so a duplicate or out-of-order
  event ends the same, and writes the plan's limits to Zitadel (§8.3). The
  server enforces limits and never asks Stripe.
- **Screens.** Settings → Billing shows each team's plan, this period's
  usage, its payment method and its invoices. "Manage payment and invoices"
  opens the Customer Portal, and "Upgrade" opens Checkout.

### 7. Support, the CRM and marketing consent (priority 3)

- **Support.** Settings → Support files a HubSpot ticket on the person's
  contact and their team's deal, and lists their own tickets. HubSpot sends
  the replies by email.
- **Subscriptions at sign-up** (decided 2026-10-30). Provisioning subscribes
  every new person to HubSpot's Newsletter (product news) and Security
  subscription types, with legal basis `LEGITIMATE_INTEREST_CLIENT`, as
  zitadel.com's portal does: opt-out, not opt-in. It writes a subscription
  only where HubSpot holds no choice yet, so an unsubscribe is never undone.
- **After sign-up, HubSpot holds it.** An email's unsubscribe link and
  Settings → Email change the same subscription. The screen reads it live,
  because HubSpot sends no webhook when it changes.
- **Onboarding mail.** A HubSpot workflow enrolls a contact once
  `zitadel_user_id` is set, with re-enrollment off, and sends it. The
  functions make no call for it.
- **Marketing contacts.** Contacts created through the API are not marketing
  contacts. A HubSpot workflow makes subscribed, verified contacts marketing
  contacts.
- **What isn't marketing.** Email about an account, its security, billing or
  support needs no subscription. Notices about the terms, the privacy policy,
  urgent security issues and maintenance go out as HubSpot transactional
  email to a segment of the cloud's contacts, which no one can leave. A
  newsletter sign-up without an account is a HubSpot form on the website.
- **Erasure.** When an account is deleted (`user.deleted`, read as in §3),
  `erase-account` deletes the HubSpot contact through HubSpot's GDPR delete,
  and removes the person from the contact fields of their team's Stripe
  customer. Invoices stay for as long as bookkeeping law requires.

### 8. What the server needs, all of it generic

1. **The platform project is a project.** It is bootstrapped with an owning
   team, Zitadel's staff, and a project secret the cloud holds. It can then
   be configured with `zitadel apply`, read its own events and be exported,
   as any claimed project can. This unblocks §3's fields and its target
   trigger.
2. **Email:** verification and sending.
3. **Usage and limits.**
   - Usage aggregates per project and hour, counting active users by their
     first activity in the month.
   - A platform operator's machine credential that reads them for the whole
     deployment.
   - Quotas per team, which a plan sets.
4. **Team roles:** who may manage a team, billing included.
5. **Team names a person reads.** A team's name stops being unique in its
   project, so two customers can both have "Acme". The personal team then
   takes the person's name instead of a hash. Its creation stays idempotent
   by keying the ensure on the person's membership, not on the name (today,
   a unique-name violation is how a concurrent ensure converges). Ideally the
   sign-up flow creates the team, generically, so every customer's sign-up
   can create a workspace (#527), and the platform project's special case
   goes.

### 9. The scaffold, and the order things go live

- Stripe and HubSpot answer from `src/mock.ts`. It keeps state per process,
  so a change made in one Vercel instance is not seen by another. Zitadel's
  reads (the person, their teams) are live, at the server the sign-in hop
  uses; its usage and plans have no API yet (§8.3).
- HubSpot's mock, and Stripe's for the customer, record the calls the live
  clients will send and send nothing. Each provisioning step returns them, so
  a run in Observability → Workflows shows them once decrypted; their log
  lines name ids, never an email.
- Production refuses mocks with `503 cloud.not_live`, and a screen that reads
  one shows its preview state instead (`whenLive`). In production, Billing says
  the cloud is free during the preview and that nothing is charged until a
  team picks a plan. Support points to Zitadel's GitHub issues, and warns that
  they are public.
- Provisioning is the exception (decided 2026-10-30): production runs it on
  the mocks too (`onboardingSystems()`), which send nothing to HubSpot or
  Stripe, so its runs show what onboarding will write. Sign-up has no call to
  action yet. The live adapters replace the mocks in production only;
  previews keep them, whatever keys their environment holds.
- The add-on's production build (`CLOUD_STAGE`) leaves out what has no
  preview state: Email, since nothing sends marketing email yet, and the
  sign-in hop and BotID client until a preview has shown them working.
  Previews get all of it; local runs get all but BotID's client, whose
  challenge only a deployment serves.
- The hourly cron is not in `vercel.json` yet. Cron runs in production only,
  where it would answer 503 every hour; it lands with the live Stripe
  adapter. `erase-account` is not scaffolded: it starts from the event
  trigger of §3.
- Each of these lands on its own:
  1. Sign-up: §8.1 and §8.5, the `.zitadel/` fields, accounts in the console
     (Console ADR 0005 §4), and the live HubSpot adapter. The website's link
     follows §8.2. The adapter needs, in HubSpot:
     - unique-value properties `zitadel_user_id` (contacts) and
       `zitadel_team_id` (deals);
     - the pipeline and first stage for a team's deal: "Cloud Pipeline", the
       legacy cloud's, or one of its own;
     - the ids of the Newsletter and Security subscription types;
     - the onboarding workflow of §7, and the notices' segment;
     - a private app with the contacts, deals and communication-preferences
       scopes, whose token only Production holds.
  2. BotID: verified on a preview, and open question 1 answered.
  3. Support and Email: HubSpot's tickets and subscriptions, live.
  4. Billing: §8.3, Stripe's meters and prices, the live adapter, the
     webhooks and the cron.

## Consequences

### Positive

- Neither the server nor the console it embeds carries Stripe, HubSpot or
  Vercel code.
- Each gap the cloud hits ships as a feature every customer gets.
- Sign-up and sign-in never wait on a third party. A third party that is
  down delays a workflow step, never a person.
- Every job can safely run again: provisioning finds what it made, usage
  counts once, and entitlements read the current state.

### Negative and risks

- One more service and its workflows to run and watch. The cloud's console
  build now compiles code from three folders.
- The sign-in widget's calls take one function invocation more on the cloud.
- The Workflow SDK pins `@swc/core` to 1.15.3, so the workspace's packages
  that peer on it moved down from 1.15.8.
- Workflows and Queues are billed per step and per operation.
- A call from the functions to a preview must pass Vercel Authentication, so
  it carries the automation bypass secret.
- Until §8.1, provisioning depends on the person opening the console once.

## Open questions

Decided 2026-10-29: a bad BotID verdict is refused until the server reads
the risk signal (§5); no subscription until Pro (§6); every member manages
billing until teams have roles (§4); no public sign-up before email
verification (§3).

1. Metronome instead of meters, if pricing needs more than sums.
2. Where the person's name for their first team comes from: a name field
   in the `register` step (§8.1), or the address's local part.

## Alternatives considered

- **Billing and support in the console behind a cloud build flag.** See
  Console ADR 0006's alternatives.
- **Zitadel pushes each event onto a Vercel queue.** That is a message per
  sign-in to get a count, and Vercel's client plus an outbox in the server.
  Lifecycle events come from `GET /events`, which customers have too.
- **Stripe and HubSpot calls in the Go server.** That puts cloud code in the
  binary self-hosters run.
- **The website as the backend.** It is already Next.js, but its rules keep
  it to the front page, and a pricing fix would redeploy the marketing site.
- **Express as the functions' host.** On Vercel it is one function as well,
  so it buys no long-running server, and the Workflow SDK runs it inside
  Nitro, whose integration is beta. It takes Node's `req` and `res`, where
  the code is written against web `Request` and `Response`. Hono would fit
  the code better, but it also runs inside Nitro. Moving later means
  rewriting the four route files.
- **A Go function per integration.** The vendors' SDKs, BotID and the
  Workflow SDK are JavaScript.
- **A database of our own** for mappings and cursors. Stripe and HubSpot
  find their records by Zitadel's ids, and the event trigger reads a window
  rather than keeping a cursor.
- **BotID in Routing Middleware or a firewall rule.** Neither can read the
  verdict (§5).
- **A `vercel.json` rewrite of `/flow` on an `Origin` match.** It would need
  no console change, but no pattern tells this deployment's preview origins
  from a customer's relay on `vercel.app`.
