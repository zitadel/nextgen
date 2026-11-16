-- +goose Up
-- See the postgres migration. SQLite can't drop a column a CHECK names or
-- change a CHECK, so the table is rebuilt.
-- +goose StatementBegin
CREATE TABLE invitations_responded (
    project_id      TEXT    NOT NULL,
    id              TEXT    NOT NULL,
    type            TEXT    NOT NULL,
    payload         TEXT    NOT NULL,
    metadata        TEXT,
    status          TEXT    NOT NULL DEFAULT 'pending',
    created_by      TEXT,
    created_by_type TEXT,
    created_at      INTEGER NOT NULL,
    expires_at      INTEGER NOT NULL,
    journey_id      TEXT    NOT NULL,
    responded_by    TEXT,
    responded_at    INTEGER,
    token_hash      TEXT    NOT NULL,
    PRIMARY KEY (project_id, id),
    CONSTRAINT chk_invitations_id CHECK (id <> ''),
    CONSTRAINT chk_invitations_type CHECK (type IN ('project_member')),
    CONSTRAINT chk_invitations_payload CHECK (json_type(payload) = 'object'),
    CONSTRAINT chk_invitations_status CHECK (status IN ('pending', 'accepted', 'rejected')),
    CONSTRAINT chk_invitations_journey_id CHECK (journey_id <> ''),
    CONSTRAINT chk_invitations_token_hash CHECK (length(token_hash) = 64),
    CONSTRAINT chk_invitations_responded CHECK (
        (status <> 'pending') = (responded_by IS NOT NULL AND responded_at IS NOT NULL)
    ),
    CONSTRAINT fk_invitations_project
        FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);
-- +goose StatementEnd

-- +goose StatementBegin
INSERT INTO invitations_responded
    (project_id, id, type, payload, metadata, status, created_by, created_by_type,
     created_at, expires_at, journey_id, token_hash)
SELECT project_id, id, type, payload, metadata, status, created_by, created_by_type,
     created_at, expires_at, journey_id, token_hash
FROM invitations;
-- +goose StatementEnd

-- +goose StatementBegin
DROP TABLE invitations;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE invitations_responded RENAME TO invitations;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE UNIQUE INDEX uq_invitations_token_hash
    ON invitations (token_hash);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_invitations_project_created_at
    ON invitations (project_id, created_at DESC, id DESC);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_invitations_project_status_expires_at
    ON invitations (project_id, status, expires_at);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
CREATE TABLE invitations_accepted (
    project_id      TEXT    NOT NULL,
    id              TEXT    NOT NULL,
    type            TEXT    NOT NULL,
    payload         TEXT    NOT NULL,
    metadata        TEXT,
    status          TEXT    NOT NULL DEFAULT 'pending',
    created_by      TEXT,
    created_by_type TEXT,
    created_at      INTEGER NOT NULL,
    expires_at      INTEGER NOT NULL,
    journey_id      TEXT    NOT NULL,
    accepted_by     TEXT,
    accepted_at     INTEGER,
    token_hash      TEXT    NOT NULL,
    PRIMARY KEY (project_id, id),
    CONSTRAINT chk_invitations_id CHECK (id <> ''),
    CONSTRAINT chk_invitations_type CHECK (type IN ('project_member')),
    CONSTRAINT chk_invitations_payload CHECK (json_type(payload) = 'object'),
    CONSTRAINT chk_invitations_status CHECK (status IN ('pending', 'accepted', 'rejected')),
    CONSTRAINT chk_invitations_journey_id CHECK (journey_id <> ''),
    CONSTRAINT chk_invitations_token_hash CHECK (length(token_hash) = 64),
    CONSTRAINT chk_invitations_accepted CHECK (
        (status = 'accepted') = (accepted_by IS NOT NULL AND accepted_at IS NOT NULL)
    ),
    CONSTRAINT fk_invitations_project
        FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);
-- +goose StatementEnd

-- +goose StatementBegin
INSERT INTO invitations_accepted
    (project_id, id, type, payload, metadata, status, created_by, created_by_type,
     created_at, expires_at, journey_id, accepted_by, accepted_at, token_hash)
SELECT project_id, id, type, payload, metadata, status, created_by, created_by_type,
     created_at, expires_at, journey_id,
     CASE WHEN status = 'accepted' THEN responded_by END,
     CASE WHEN status = 'accepted' THEN responded_at END,
     token_hash
FROM invitations;
-- +goose StatementEnd

-- +goose StatementBegin
DROP TABLE invitations;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE invitations_accepted RENAME TO invitations;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE UNIQUE INDEX uq_invitations_token_hash
    ON invitations (token_hash);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_invitations_project_created_at
    ON invitations (project_id, created_at DESC, id DESC);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_invitations_project_status_expires_at
    ON invitations (project_id, status, expires_at);
-- +goose StatementEnd
