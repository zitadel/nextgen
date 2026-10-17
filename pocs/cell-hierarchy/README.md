# Cell hierarchy POC (Phase 1)

Greenfield multi-container Go cells with SQLite membership, join/heartbeat, and an HTMX UI.

Lives under `pocs/cell-hierarchy/` as a nested Go module (not wired into Moon/CI).

## Topology (after bootstrap)

```text
platform (parent)
├── eu (parent)
│   ├── eu-1 (leaf)
│   └── eu-2 (leaf)
├── us (leaf)
└── aus (leaf)
spare — unjoined until an operator joins it
```

## Quick start

```bash
cd pocs/cell-hierarchy
./scripts/run-local.sh
# or: docker compose up --build
```

- UI: http://localhost:3000
- Cells: http://localhost:8100–8106

## Operator: join spare

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
