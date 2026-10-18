# Cell hierarchy POC (Phase 1–3)

Greenfield multi-container Go cells with SQLite membership, join/heartbeat, project attach, user lookup float-up, regional apps/grants with home-cell interest registration, and an HTMX UI.

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
├── us            [lookup off]  hosted on us · app chat
└── aus           [lookup off]  hosted on aus
```

**Locked decisions**

- Cell tree stays membership-only; project tree is separate.
- Platform PROJECT (hosted on platform CELL) has lookup ON — it is the customer lookup zone.
- User routing floats on PROJECT parents only. Lookup never walks children.
- Identifier uniqueness: under one lookup-enabled ancestor (platform), first-write-wins conflict.
- Float-up push; lookup miss if the row is not yet at the ancestor you ask.
- Grants (tuples) live on the **resource** project cell; interests live on the principal’s **home** cell.

## Quick start

```bash
cd pocs/cell-hierarchy
./scripts/run-local.sh
# or: docker compose up --build
```

- UI: http://localhost:3000
- Cells: http://localhost:8100–8106
- Bootstrap runs joins then `scripts/bootstrap-projects.sh` (projects, attach, seed users with float, seed `chat` app on `us`).

## Phase 3 scenarios

| Scenario | How |
|---|---|
| Grant Joe on us/chat | UI → Scenarios → **Grant Joe on us/chat**. Trace shows lookup walk + tuple write on us + `POST /v1/interests` on eu-2 |
| Inspect placement | Project `us`: apps + tuples. Project `team-eu-2`: interests for Joe; users still only Bob/Joe locally. No Joe user row on `us`. |

Manual curl (after bootstrap):

```bash
# Grant (lookup resolves Joe at platform → home team-eu-2 @ eu-2)
curl -sS -X POST http://127.0.0.1:8104/v1/projects/us/tuples \
  -H 'Content-Type: application/json' \
  -d '{"object":"app:chat","relation":"viewer","user_key":"joe@example.com"}' | jq .

# Tuple only on us
curl -sS http://127.0.0.1:8104/v1/projects/us/tuples | jq .
# Interest only on home (eu-2)
curl -sS 'http://127.0.0.1:8103/v1/interests?home_project_id=team-eu-2' | jq .
```

## Phase 2 scenarios

| Scenario | How |
|---|---|
| Create user (watch float) | UI → Scenarios → create on `team-eu-2`; Global Trace shows hops eu-2 → eu → platform |
| Lookup from us before float | Create with **Defer float**, then Lookup from us → miss |
| Lookup from us after float | Create without defer (or float later) → Lookup from us walks up to platform → hit |
| Conflict | Same email from two homes under platform → `lookup_conflict` |

Optional demo delay: set `FLOAT_DELAY_MS` on a cell so each float push sleeps (miss-before-push is easier to see with defer float + manual lookup).

### Seed users / apps

| User | Project |
|---|---|
| alice@example.com | team-eu-1 |
| bob@example.com | team-eu-2 |
| joe@example.com | team-eu-2 |

| App | Project (cell) |
|---|---|
| chat | us (us) |

## Phase 3 HTTP APIs

| Method | Path | Purpose |
|---|---|---|
| `GET/POST` | `/v1/projects/{id}/apps` | List / create apps on this project |
| `GET/DELETE` | `/v1/projects/{id}/apps/{appId}` | Get / delete one app |
| `GET/POST` | `/v1/projects/{id}/tuples` | List / create grant (lookup walk → tuple → RegisterInterest on home) |
| `GET` | `/v1/interests` | List interests on this cell (`?home_project_id=` optional) |
| `POST` | `/v1/interests` | RegisterInterest (called by resource cell on home cell) |

`GET /v1/projects/{id}` also returns `apps`, `tuples`, and `interests` (interests filtered to this project as home).

## Phase 2 HTTP APIs

| Method | Path | Purpose |
|---|---|---|
| `GET/POST` | `/v1/projects` | List / create projects on this cell |
| `GET` | `/v1/projects/{id}` | Project + users + lookup + apps + tuples + interests |
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
