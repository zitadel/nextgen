-- +goose Up
-- A release is an immutable, project-scoped snapshot pinning one revision per
-- (kind, handle) (ADR 035). Pointers live in a JSONB column rather than a child
-- table: no endpoint addresses a single pointer, the release is only ever read
-- whole, and a new kind then costs a Go enum value instead of a migration on
-- every dialect.
CREATE TABLE zitadel_nextgen.releases (
    project_id TEXT COLLATE "C" NOT NULL
        REFERENCES zitadel_nextgen.projects (id) ON DELETE CASCADE
    , id TEXT COLLATE "C" NOT NULL CHECK (id <> '')
    -- SHA-256 (hex) over the canonicalized pointer set. Metadata is excluded,
    -- so re-submitting the same revisions under a new message resolves to this
    -- same row. Computed in Go: Spanner's JSON type does not round-trip bytes,
    -- so the pointers column can never be the hash preimage.
    , content_hash TEXT COLLATE "C" NOT NULL CHECK (length(content_hash) = 64)
    , pointers JSONB NOT NULL
        CHECK (jsonb_typeof(pointers) = 'array' AND jsonb_array_length(pointers) > 0)
    -- Who assembled the release, from what commit, and why. A document rather
    -- than columns because nothing queries it: it is written once and handed
    -- back verbatim, so a new field here costs no migration on three dialects.
    -- Anything that needs filtering or ordering earns a column instead, which
    -- is why created_at is one.
    , metadata JSONB NOT NULL
        CHECK (jsonb_typeof(metadata) = 'object')
    , created_at TIMESTAMPTZ NOT NULL DEFAULT now()

    , PRIMARY KEY (project_id, id)
);

-- The idempotency key. Creating a release resolves an identical pinned set to
-- the release that already holds it; this index is what makes that hold under
-- concurrency rather than only in the read-then-insert happy path.
CREATE UNIQUE INDEX uq_releases_project_content_hash
    ON zitadel_nextgen.releases (project_id, content_hash);

-- Releases list newest-first by keyset; id breaks created_at ties.
CREATE INDEX idx_releases_project_created_at
    ON zitadel_nextgen.releases (project_id, created_at DESC, id DESC);

-- +goose Down
DROP INDEX IF EXISTS zitadel_nextgen.idx_releases_project_created_at;
DROP INDEX IF EXISTS zitadel_nextgen.uq_releases_project_content_hash;
DROP TABLE IF EXISTS zitadel_nextgen.releases;
