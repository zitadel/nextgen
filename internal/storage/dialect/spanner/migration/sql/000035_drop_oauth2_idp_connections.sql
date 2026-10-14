-- +goose NO TRANSACTION
-- +goose Up
-- OAuth 2.0 identity provider connections are no longer supported; see the
-- postgres migration. Links go first because their connection FK is NO ACTION,
-- then the scope index row, which nothing cascades, while the revisions still
-- identify it. The revisions cascade from the connection (000025). Without a
-- transaction a failure can leave the first deletes applied, but every
-- statement selects through the revisions, so a rerun finishes the job.
-- +goose StatementBegin
DELETE FROM idp_identity_links AS l
WHERE EXISTS (
    SELECT 1 FROM idp_connection_revisions AS r
    WHERE r.project_id = l.project_id
        AND r.connection_id = l.connection_id
        AND JSON_VALUE(r.document, '$.protocol') = 'oauth2'
)
-- +goose StatementEnd
-- +goose StatementBegin
DELETE FROM resource_scope_index AS s
WHERE s.resource_kind = 'idp_connection'
    AND EXISTS (
        SELECT 1 FROM idp_connection_revisions AS r
        WHERE r.project_id = s.project_id
            AND r.connection_id = s.resource_id
            AND JSON_VALUE(r.document, '$.protocol') = 'oauth2'
    )
-- +goose StatementEnd
-- +goose StatementBegin
DELETE FROM idp_connections AS c
WHERE EXISTS (
    SELECT 1 FROM idp_connection_revisions AS r
    WHERE r.project_id = c.project_id
        AND r.connection_id = c.id
        AND JSON_VALUE(r.document, '$.protocol') = 'oauth2'
)
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- No-op: the deleted connections cannot be restored; see the postgres
-- migration.
