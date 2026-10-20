# Cell hierarchy POC — sites & workspaces

Greenfield multi-container Go cells with SQLite membership, join/heartbeat, **sites as projects** (workspace UX metadata), user lookup float-up with **provenance**, regional apps/grants with home-cell interest registration, inspectable home-issued JWTs, resource-cell auth checks, cross-cell group Expand/Check, user block/delete with grant tombstones, Create/Expand site forms, Global login discovery, and an HTMX UI.

Lives under `pocs/cell-hierarchy/` as a nested Go module (not wired into Moon/CI).

## Topology

### Cell tree (ops / membership)

Region aggregator cells (`eu`, `us`) are gone. Leaves join **directly under platform**:

```text
platform (parent cell, is_parent=true)     port 8100
├── eu-1  EU · Frankfurt                   port 8101
├── eu-2  EU · Lisbon                      port 8102
├── us-1  US · Iowa                        port 8103
└── us-2  US · San Francisco               port 8104
spare (unjoined)                           port 8105
```

Human labels come from `CELL_DISPLAY` (shown in `/v1/me` as `display`). A leaf can become a parent later via `POST /v1/me/parent` or `POST /v1/admin/enable-parent` (join invites still use `POST /v1/join/prepare`).

### Sites = projects (A storage); Workspace = C UI

Each **site** is a project hosted on exactly one customer-chosen cell. **Workspace** is UX only: group sites by `workspace_id` string metadata on the project. The platform project remains the lookup zone (`lookup_enabled=true`).

```text
platform PROJECT  [lookup ON]  ← global login / lookup zone
└── acme-fra      [workspace=acme]  hosted on eu-1 · Joe, Alice · app chat
    (Expand demo adds acme-iowa on us-1)
```

**Locked decisions**

- Cell tree = membership only; site/project tree is separate (attach to platform).
- Lookup floats on PROJECT parents only; never walks children.
- Lookup provenance: `source=local|child`, `via_project` = child project id when floated.
- Grants live on the **resource** site cell; interests on the principal’s **home** site cell.
- Block/delete fan-out only to interest subscribers (tombstone grants; rows stay listed).

## Quick start

```bash
cd pocs/cell-hierarchy
./scripts/run-local.sh
# or: docker compose up --build
```

| Surface | URL |
|---|---|
| UI | http://localhost:3000 |
| Workspace acme | http://localhost:3000/workspaces/acme |
| Create / Expand | http://localhost:3000/create |
| Scenarios | http://localhost:3000/scenarios |
| Cells | http://localhost:8100–8105 |

Bootstrap: joins (all leaves → platform) then `scripts/bootstrap-projects.sh` (platform + `acme-fra`, users, `chat`, Phase 5 group chain).

## Project overview CRUD

Day-to-day resource management lives on **`/projects/{id}`** (prefer that over `/create`). Forms post back to the same page with `?ok=` / `?err=` flash. Mutations append to Global Trace.

| Resource | Add | Remove |
|---|---|---|
| Users | email + optional lifecycle team (empty = project-managed) | delete → existing tombstone/interest fan-out |
| Teams | name + optional parent team | blocked if users or child teams remain |
| Groups | name (first-class; `UNIQUE(project_id,name)`) | blocked while active tuples reference `group:{name}` as object or group subject |
| Apps | name | blocked while active tuples reference `app:{name}` |
| Tuples | object (app/group select or free-text), relation, subject user/group | tombstone by id (row stays; unregister interest on home for user subjects) |

Nextgen projects have no parent tree (platform claim is separate). POC `parent_project` is **lookup-only** and optional until attach.

## Create / Expand (C UI)

| Form | Behavior |
|---|---|
| **Create site** | Workspace id (default `acme`), site id/name, **cell** (required), parent default `platform`. Creates project on that cell + attach. |
| **Expand site** | Pick source site, new cell, optional new id (defaults e.g. `acme-iowa` for us-1), copy `chat` checkbox. Sibling project + attach + apps. |
| Team / App | Also available on project overview; `/create` kept for site bootstrap. |

## Global login discovery

Conceptual entry URL is global. Scenario **Global login**:

1. User enters email  
2. Lookup walk starts at **platform** project (on platform cell)  
3. Shows redirect target: `home_project`, `home_cell`, issuer hint  
4. Optionally issues token at home and `auth/check` on home site’s `chat`

## Lookup provenance

On `lookup_entries`:

| Field | Values |
|---|---|
| `source` | `local` (created here) · `child` (floated from a child) |
| `via_project` | child project id when floated; empty if local |

Project detail + platform lookup table show badges: **local** vs **from child &lt;id&gt;**.

## Seed

| User | Site |
|---|---|
| joe@example.com | acme-fra @ eu-1 |
| alice@example.com | acme-fra @ eu-1 |

| App | Site |
|---|---|
| chat | acme-fra |

Group chain (Phase 5):

```text
eu-1 / acme-fra:  group:A#member@user:joe@example.com
platform:         group:B#member@group:A@acme-fra
eu-1 / acme-fra:  app:chat#viewer@group:B@platform
```

## Demo walkthrough

1. `./scripts/run-local.sh` → http://localhost:3000  
2. **Tree** — platform with four leaf cells; project tree shows platform → acme-fra  
3. **Workspace acme** — list sites with cell labels and counts  
4. **Create → Expand** — expand to us-1 → `acme-iowa` with chat  
5. **Scenarios → Global login** — joe → acme-fra @ eu-1  
6. **Project platform** — lookup rows show **from child acme-fra**  
7. **Grant / Sign-in / Group check / Block / Delete** — use entry cell `eu-1` (or `us-1` after expand)

## Phase APIs (summary)

Join, projects/attach/users/float/lookup, apps/tuples/interests, token/JWKS/auth/check, FGA check/expand, block/delete/events, teams — same paths as prior phases. Additions:

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/me/parent` | Flip `is_parent=true` on this cell |
| `POST` | `/v1/admin/enable-parent` | Alias of the above |
| Project create | `workspace_id` | Site workspace metadata |
| Lookup entries | `source`, `via_project` | Provenance |
| `POST` | `/v1/projects/{id}/users` | `lifecycle_owner_team_id` optional |
| `DELETE` | `/v1/projects/{id}/teams/{teamId}` | Reject if users/children |
| `GET/POST` | `/v1/projects/{id}/groups` | First-class groups |
| `DELETE` | `/v1/projects/{id}/groups/{groupId}` | Reject if active tuples |
| `DELETE` / `POST …/tombstone` | `/v1/projects/{id}/tuples/{tupleId}` | Tombstone grant + unregister interest |
| `DELETE` | `/v1/interests/by-tuple/{tupleId}` | Home-side interest cleanup |

## Tests

```bash
cd pocs/cell-hierarchy && go test ./...
```

Covers: bootstrap joins under platform, expand sibling on us-1, lookup provenance, global login discovery, grant/delete tombstone across sites, plus prior join/auth/FGA/team coverage retargeted to site ids.
