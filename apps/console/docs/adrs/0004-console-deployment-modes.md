# Console ADR 0004: Deployment modes and control-project bootstrap

> **Status:** Proposed
> **Date:** 2026-07-23; revised 2026-08-13 after the cross-project
> authorization and first-operator bootstrap design
> **Implementation state:** `GET /console/runtime.json`, runtime discovery,
> the no-project hint, `platform.project_id`, first-created-project fallback,
> and the flag-gated row-only `platform.bootstrap_project` path exist. The
> first-created fallback and row-only bootstrap are transitional behavior, not
> the target described here. The full platform-project provisioner,
> first-party Console session authorization, effective-permission exposure,
> and seed-input contract remain future work.
> **Scope:** `apps/console`, plus the server-owned bootstrap and authorization
> contracts on which it depends. See
> [`apps/console/AGENTS.md`](../../AGENTS.md).
> **Context:** Issues [#555](https://github.com/zitadel/nextgen/issues/555)
> (Console / Customer Portal epic) and
> [#527](https://github.com/zitadel/nextgen/issues/527) (platform-project
> bootstrap).

## Context

One Console build must serve two product postures:

- **Standalone** is the default self-hosted posture. It should be useful with
  one customer project and one operator team, without forbidding an operator
  from creating more projects later.
- **Platform** hosts many customer projects. Platform-project users can receive
  direct or team-derived access to selected customer projects. A platform
  role alone never means access to every project.

Both postures need a stable place to authenticate Console operators before a
customer project exists. Reusing an arbitrary customer application project as
the Console login project mixes two identities that have different lifecycles:
platform operators and the end-users managed by the customer project.

The current first-created-project fallback avoided an empty bootstrap project,
but it also made whichever project happened to be created first the Console's
identity boundary. The current `platform.bootstrap_project` path only inserts
the reserved row; it does not provision keys, login flows, user schemas, an
initial operator, teams, or authorization assignments. Neither behavior is a
complete bootstrap contract.

The following repository-wide decisions constrain this ADR:

- root [ADR 052](../../../../docs/adrs/052-cross-project-principals.md) keeps
  the authenticated user's home project distinct from the protected customer
  project and authorizes every target explicitly;
- root [ADR 053](../../../../docs/adrs/053-customer-collaboration-grants.md)
  keeps team membership, team ownership, and project access as separate
  facts, and supports both direct-user and team-derived project grants;
- root [ADR 046](../../../../docs/adrs/046-claim-lifecycle-v2.md) uses the
  platform project for registration and claim in hosted deployments;
- root [ADR 036](../../../../docs/adrs/036-api-credential-planes.md), as
  amended by ADR 052, permits operator-plane calls authenticated by a
  confidential automation credential or a first-party human session; and
- root [ADR 048](../../../../docs/adrs/048-wide-events-internal-audit-primitive.md)
  records the human actor and the assignment path that authorized a mutation.

## Decision

### 1. Every bootstrapped deployment has one reserved platform project

The reserved platform project is the Console operator identity boundary in
both standalone and platform modes. The Console always signs into that
project. Customer projects remain ordinary protected resources selected after
sign-in.

The reserved project is a **control project**, not a super-project:

- a role in it does not imply access to any customer project;
- access to a customer project comes only from that project's owning-team,
  direct-user, team, or confidential-project assignment under ADRs 052 and
  053; and
- it is never used as the hosted-login project for a customer's application.

Standalone remains the default product posture, not a different authorization
model. Its bootstrap may create one initial customer project and one owner
team, and the initial Console can optimize for that common path. The data model
and APIs do not enforce a one-project ceiling.

### 2. Bootstrap is explicit desired state

The server may start with no projects. In that state the embedded Console is
available but cannot offer sign-in; it shows a bootstrap instruction instead.
The first arbitrary `POST /projects` must not silently become the control
project.

Bootstrap consumes an explicit seed input and reconciles it idempotently. The
input transport is deliberately not fixed here:

- test and development infrastructure may provide the desired state through
  the testkit now;
- a later server-owned seed file may provide the same desired state for
  self-hosted deployments; and
- a future CLI command or Console wizard may collect the values and invoke the
  same server contract rather than inventing another provisioning path.

All transports must converge on the same persisted resources and invariants.
The minimum useful seed provisions, in one operation:

1. the reserved platform project through the normal full project provisioner,
   including its keys, default user schema, and login flow;
2. at least one initial platform user who can sign into the Console;
3. a default team plus that user's `team_memberships` row;
4. a separate `team.owner` authorization assignment for the initial owner;
   and
5. optionally, one initial customer project, its `project.owning_team`
   relation, and any explicit direct-user or team access assignments.

Membership in step 3 is roster state only. It neither creates project access
nor substitutes for the separate owner assignment in step 4. The bootstrap
transaction maintains the invariant that every team owner is an active team
participant.

The existing `platform.bootstrap_project` row-only behavior is insufficient
and must be replaced or routed through this provisioner. The same is true for
`--user-file` behavior that inserts a bare project row only to satisfy foreign
keys. Because the product is alpha, the checked-in seed behavior and test
fixtures may be corrected directly; no compatibility migration or backfill is
required for pre-release development databases.

**Cutover rule:** the implemented first-created-project fallback remains
available until a human-usable replacement—such as the server-owned seed
file—ships with the full provisioner and an end-to-end first-operator test. The
testkit can prove the target shape before that point, but test infrastructure
alone must not strand a self-hoster. Only after that replacement exists may the
server stop resolving the first-created project and require the reserved
platform-project seed.

Bootstrap inputs are server-side configuration. Secrets from them never enter
`runtime.json`, the Console bundle, or browser-readable storage.

### 3. Runtime discovery carries only the Console sign-in target

The embedded Console discovers public, pre-session facts from the existing
same-origin endpoint:

```http
GET /console/runtime.json

{
  "mode": "standalone" | "platform",
  "console_project_id": "proj_platform",
  "publishable_key": "pk_proj_..."
}
```

`console_project_id` and `publishable_key` identify the reserved platform
project. They are omitted while bootstrap has not completed. The response is
resolved per request and served with `no-store`, so completing bootstrap does
not require a server restart.

The publishable key is browser-safe public-plane material under ADR 036. The
document never contains a project secret, seed credential, license key,
customer-project list, or permission inventory. Customer projects are
authorized API data loaded after sign-in.

`mode` affects product copy and which deployment features the server offers;
it does not choose a different Console login project and does not grant access.
`VITE_CONSOLE_PROJECT_ID` remains a development-only override.

### 4. The embedded Console uses a first-party session credential

The Console performs same-origin API calls with its HttpOnly
`__nextgen_session` cookie. It does not receive a project secret and does not
store a script-readable session bearer. The server resolves the platform user
from that first-party session, then evaluates the target customer project with
the same ADR 052 authorization resolver used for confidential automation.

Cookie-authenticated unsafe methods require the exact-Origin and
session-bound-CSRF protections in
[ADR 052 §5](../../../../docs/adrs/052-cross-project-principals.md), which
amends ADR 046's SameSite-only conclusion. A successful Console login therefore
establishes identity, not blanket management authority.

The development proxy may temporarily inject a project secret while the
session-derived path is incomplete, but that is development compatibility,
not the embedded deployment contract. Until the session resolver and the
required assignments exist, management calls fail closed. The Console must
not compensate by exposing a secret or treating every authenticated platform
user as an administrator.

### 5. Portal surfaces render from effective permissions

Two questions govern a portal surface:

- does this deployment offer the feature; and
- may this signed-in user use it on the selected project?

The server answers both. It intersects the deployment's offered features with
the user's effective permissions for the selected target. The Console renders
from that result through route `staticData.permission`; it does not keep a
parallel capability vocabulary or infer authority from `mode`, membership, or
navigation state.

```ts
export const Route = createFileRoute("/_authed/billing/")({
  staticData: {
    nav: { label: "Billing", order: 8, icon: CreditCard },
    permission: "billing.read",
  },
  // ...
});
```

The sidebar and a route guard hide unavailable routes, but UI gating is never
authorization. Each API operation performs its own target-scoped check.

### 6. Standalone and platform differ in defaults, not primitives

After bootstrap, both modes use the same resources:

| Concern                | Standalone default                                           | Platform default                  |
| ---------------------- | ------------------------------------------------------------ | --------------------------------- |
| Console identity       | User in reserved platform project                            | User in reserved platform project |
| Initial customer scope | Usually one seeded project                                   | Zero or many projects             |
| Access                 | Owning-team, direct-user, team, or project-secret assignment | Same                              |
| Project count          | UI optimized for one; additional projects allowed            | Multi-project navigation          |
| Portal features        | Disabled unless configured/licensed                          | Configured by the platform        |

This avoids a future conversion from a special single-project security model
to a platform model. A standalone installation can add projects and grants
without changing its Console build or moving operator identities.

## Consequences

- One Console artifact and one authorization model serve cloud and self-host.
- A newly started server remains valid without data, but Console sign-in waits
  for an explicit, complete bootstrap.
- The reserved platform project is no longer cloud-only and no arbitrary
  customer project becomes the Console identity boundary.
- Membership and access remain independent. Bootstrap writes membership,
  ownership, and project grants explicitly, even when one transaction creates
  all three.
- Direct-user grants and team-derived grants are both usable from the Console;
  neither changes team membership.
- Standalone is simple by default but not artificially limited to one project.
- Existing alpha databases and fixtures may be recreated after the seed
  contract changes; no migration is promised.
- Effective-permission exposure, CSRF enforcement, and session-derived
  target authorization are server dependencies. The Console remains
  fail-closed until they land.

## Related work

- Issues [#555](https://github.com/zitadel/nextgen/issues/555),
  [#527](https://github.com/zitadel/nextgen/issues/527),
  [#96](https://github.com/zitadel/nextgen/issues/96),
  [#419](https://github.com/zitadel/nextgen/issues/419), and
  [#333](https://github.com/zitadel/nextgen/issues/333).
- [Console ADR 0001](0001-console-routing.md),
  [0002](0002-console-api-access.md), and
  [0003](0003-console-authentication.md).
- Root ADRs [024](../../../../docs/adrs/024-user-team-lifecycle-ownership.md),
  [032](../../../../docs/adrs/032-permission-catalogs.md),
  [033](../../../../docs/adrs/033-internal-permission-management.md),
  [035](../../../../docs/adrs/035-configuration-environments.md),
  [036](../../../../docs/adrs/036-api-credential-planes.md),
  [046](../../../../docs/adrs/046-claim-lifecycle-v2.md),
  [048](../../../../docs/adrs/048-wide-events-internal-audit-primitive.md),
  [052](../../../../docs/adrs/052-cross-project-principals.md), and
  [053](../../../../docs/adrs/053-customer-collaboration-grants.md).
