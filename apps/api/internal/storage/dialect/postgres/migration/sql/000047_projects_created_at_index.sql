-- +goose Up
-- Projects newest first is the order the Projects list reads (console D28) and
-- the order a session's search reads the projects it searches (ADR 087 §6).
-- With no index on it, a page of either sorted every project of the
-- deployment, which a platform operator reads all of. Read backwards, this
-- index serves created_at DESC, id DESC, and forwards the ascending order.
CREATE INDEX IF NOT EXISTS idx_projects_created_at
    ON zitadel_nextgen.projects (created_at, id);

-- +goose Down
DROP INDEX IF EXISTS zitadel_nextgen.idx_projects_created_at;
