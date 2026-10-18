# Cell hierarchy POC (Phase 1 + Phase 2)

Greenfield multi-container Go cells with SQLite membership, join/heartbeat, project attach, user lookup float-up, and an HTMX UI.

Lives under `pocs/cell-hierarchy/` as a nested Go module (not wired into Moon/CI).

## Topology

### Cell tree (membership — Phase 1)

```text
platform (parent)
├── eu (parent)
│   ├── eu-1 (leaf)
│   └── eu-2 (leaf)
├── us (leaf)
└── aus (leaf)
spare — unjoined until an operator joins it
```

### Project tree (separate from cells — Phase 2)

```text
platform PROJECT  [lookup ON]  ← customer lookup zone (no separate CusB)
├── eu            [lookup ON]   hosted on eu cell
│   ├── team-eu-1 [lookup off]  hosted on eu-1 · Alice
│   └── team-eu-2 [lookup off]  hosted on eu-2 · Bob, Joe
├── us            [lookup off]  hosted on us
└── aus           [lookup off]  hosted on aus
```

**Locked decisions**

- Cell tree stays membership-only; project tree is separate.
- Platform PROJECT (hosted on platform CELL) has lookup ON — it is the customer lookup zone.
- User routing floats on PROJECT parents only. Lookup never walks children.
- Identifier uniqueness: under one lookup-enabled ancestor (platform), first-write-wins conflict.
- Float-up push; lookup miss if the row is not yet at the ancestor you ask.

## Quick start

```bash
cd pocs/cell-hierarchy
./scripts/run-local.sh
# or: docker compose up --build
```

- UI: http://localhost:3000
- Cells: http://localhost:8100–8106
- Bootstrap runs joins then `scripts/bootstrap-projects.sh` (projects, attach, seed users with float).

## Phase 2 scenarios

| Scenario | How |
|---|---|
| Create user (watch float) | UI → Scenarios → create on `team-eu-2`; Global Trace shows hops eu-2 → eu → platform |
| Lookup from us before float | Create with **Defer float**, then Lookup from us → miss |
| Lookup from us after float | Create without defer (or float later) → Lookup from us walks up to platform → hit |
| Conflict | Same email from two homes under platform → `lookup_conflict` |

Optional demo delay: set `FLOAT_DELAY_MS` on a cell so each float push sleeps (miss-before-push is easier to see with defer float + manual lookup).

### Seed users

| User | Project |
|---|---|
| alice@example.com | team-eu-1 |
| bob@example.com | team-eu-2 |
| joe@example.com | team-eu-2 |

## Phase 2 HTTP APIs

| Method | Path | Purpose |
|---|---|---|
| `GET/POST` | `/v1/projects` | List / create projects on this cell |
| `GET` | `/v1/projects/{id}` | Project + users + lookup table |
| `POST` | `/v1/projects/{id}/attach` | Attach to parent project on parent cell |
| `POST` | `/v1/projects/{id}/users` | Create user → local lookup → float (`defer_float` optional) |
| `POST` | `/v1/projects/{id}/float` | Push an existing local lookup row up |
| `POST` | `/v1/lookup` | Single-table lookup for `{project_id, key}` |
| `POST` | `/v1/lookup/push` | Parent receives float-up row (idempotent; conflict on different home) |
| `POST` | `/v1/lookup/walk` | Helper: walk UP parent pointers until hit or root |

## Operator: join spare (Phase 1)

1. Open http://localhost:3000/join
2. Parent: `platform` or `eu`
3. Unjoined cell: `spare`
4. Click **Join**
5. Stop spare — node goes grey/down within ~15s; restart recovers

## Invalid join scenarios

| Action | Expected |
|---|---|
| Prepare on a leaf (`us`, `aus`, `eu-1`, `eu-2`) | `parent_not_accepting_children` |
| Complete with ancestor URL as child | `join_would_create_cycle` |
| Complete twice with same child URL | `duplicate_child` |
| Expired/unknown token | `invalid_join_token` |

## Join protocol

1. `POST /v1/join/prepare` (empty body) → invite
2. `POST /v1/join/accept` on child with invite
3. Child `POST /v1/join/complete` with its `child_url`
4. Heartbeat: `Authorization: Bearer <join_secret>` every 5s

## Tests

```bash
cd pocs/cell-hierarchy && go test ./...
```
