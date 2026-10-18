# Cell hierarchy POC (Phase 1–5)

Greenfield multi-container Go cells with SQLite membership, join/heartbeat, project attach, user lookup float-up, regional apps/grants with home-cell interest registration, inspectable home-issued JWTs (Ed25519 / JWKS), resource-cell auth checks, cross-cell group Expand/Check with hop traces, and an HTMX UI.

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
- Bootstrap runs joins then `scripts/bootstrap-projects.sh` (projects, attach, seed users with float, seed `chat` app on `us`, seed Phase 5 group chain).

## Phase 5 scenarios

| Scenario | How |
|---|---|
| Seed group chain | UI → Scenarios → **Seed group chain** (or rely on bootstrap / auto-seed). Creates `group:A#member@joe` on eu-2, `group:B#member@group:A@eu-2` on eu, `app:chat#viewer@group:B@eu` on us. |
| Group check Joe → app:chat | UI → Scenarios → set **delay slider** → **Group check**. `POST /v1/fga/check` on us walks viewers → RPC expand B on eu → RPC expand A on eu-2 → find Joe. Trace lists each hop + ms; total and cross-cell hop count shown. |
| Delay grows latency | Same check with delay 0 vs 50–200 ms/hop — measured `total_ms` grows. |
| Cycle guard | Mutual group membership across cells stops via visited set (and max depth 8). |

Chain (Zanzibar-style):

```text
eu-2 / team-eu-2:  group:A#member@user:joe@example.com
eu    / eu:        group:B#member@group:A@team-eu-2@<eu-2>
us    / us:        app:chat#viewer@group:B@eu@<eu>
```

Optional note: a Phase 3 flattened direct grant (`app:chat#viewer@user:joe` on us) is one local hop — no cross-cell expand.

Manual curl (after bootstrap):

```bash
# Check through the group chain (delay_ms optional, applied per hop)
curl -sS -X POST http://127.0.0.1:8104/v1/fga/check \
  -H 'Content-Type: application/json' \
  -d '{"project_id":"us","object":"app:chat","relation":"viewer","user_key":"joe@example.com","delay_ms":25}' | jq .

# Expand group B on eu
curl -sS -X POST http://127.0.0.1:8101/v1/fga/expand \
  -H 'Content-Type: application/json' \
  -d '{"project_id":"eu","object":"group:B","relation":"member","delay_ms":0}' | jq .
```

Env: `FGA_DELAY_MS` on a cell applies a default per-hop sleep when the request omits `delay_ms`.

## Phase 4 scenarios

| Scenario | How |
|---|---|
| Sign in on us as Joe | UI → Scenarios → **Sign in on us as Joe**. Lookup from us → issue JWT at eu-2 → auth check on us (offline + online). Raw token + decoded claims shown. Auto-grants if the Phase 3 tuple is missing. |
| Deny without grant | Uncheck auto-grant (and clear the us tuple), then sign-in → `grant_denied`. Or curl auth/check before granting. |
| Tampered token | Alter JWT payload without re-signing → `token_signature_invalid`. |

Manual curl (after bootstrap + grant):

```bash
# Issue at home (eu-2 hosts team-eu-2)
TOKEN=$(curl -sS -X POST http://127.0.0.1:8103/v1/token/issue \
  -H 'Content-Type: application/json' \
  -d '{"project_id":"team-eu-2","sub":"joe@example.com","aud":"app:chat"}')
echo "$TOKEN" | jq .

# JWKS on home
curl -sS http://127.0.0.1:8103/v1/jwks | jq .

# Auth check on us (resource cell) with online principal check
curl -sS -X POST http://127.0.0.1:8104/v1/auth/check \
  -H 'Content-Type: application/json' \
  -d "$(jq -n --arg t "$(echo "$TOKEN" | jq -r .token)" \
    '{token:$t, project_id:"us", object:"app:chat", relation:"viewer", online:true}')" | jq .
```

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

## Phase 5 HTTP APIs

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/fga/check` | `{project_id, object, relation, user_key, delay_ms?, max_depth?, visited?}` → walk local tuples; RPC expand remote group subjects; return `{allowed, reason, trace, total_ms, cross_cell_hops}` |
| `POST` | `/v1/fga/expand` | `{project_id, object, relation, delay_ms?, max_depth?, visited?, depth?}` → flatten members (users) via live cross-cell RPCs; cycle/depth guards |

Tuple create also accepts `subject_kind: "user"|"group"` so subjects can be `group:…` with `home_project_id` / `home_cell_url`.

## Phase 4 HTTP APIs

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/jwks` | Public Ed25519 JWK set (key persisted in SQLite across restarts) |
| `POST` | `/v1/token/issue` | Home cell: `{project_id, sub, aud, epoch?}` → compact JWT + decoded claims |
| `POST` | `/v1/principal/check` | Home cell: `{project_id, sub, epoch?}` → `{active, blocked, epoch}` (P6 adds block) |
| `POST` | `/v1/auth/check` | Resource cell: `{token, project_id, object, relation, online}` → verify JWKS, optional online principal check, local **user** grant (group chains use `/v1/fga/check`) |

JWT claims: `sub`, `home_cell`, `home_project`, `aud`, `epoch`, `exp` (60s TTL), `iss` (cell URL). Alg: `EdDSA`.

## Phase 3 HTTP APIs

| Method | Path | Purpose |
|---|---|---|
| `GET/POST` | `/v1/projects/{id}/apps` | List / create apps on this project |
| `GET/DELETE` | `/v1/projects/{id}/apps/{appId}` | Get / delete one app |
| `GET/POST` | `/v1/projects/{id}/tuples` | List / create grant (user: lookup walk → tuple → RegisterInterest; group: structured subject, no interest) |
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
