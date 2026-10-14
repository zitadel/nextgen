-- +goose Up
-- OAuth 2.0 identity provider connections are no longer supported; see the
-- postgres migration. Links go first because their connection FK is NO ACTION,
-- then the scope index row, which nothing cascades, while the revisions still
-- identify it. The revisions cascade from the connection.
-- +goose StatementBegin
DELETE FROM idp_identity_links
WHERE EXISTS (
    SELECT 1 FROM idp_connection_revisions AS r
    WHERE r.project_id = idp_identity_links.project_id
        AND r.connection_id = idp_identity_links.connection_id
        AND json_extract(r.document, '$.protocol') = 'oauth2'
);
-- +goose StatementEnd

-- +goose StatementBegin
DELETE FROM resource_scope_index
WHERE resource_kind = 'idp_connection'
    AND EXISTS (
        SELECT 1 FROM idp_connection_revisions AS r
        WHERE r.project_id = resource_scope_index.project_id
            AND r.connection_id = resource_scope_index.resource_id
            AND json_extract(r.document, '$.protocol') = 'oauth2'
    );
-- +goose StatementEnd

-- +goose StatementBegin
DELETE FROM idp_connections
WHERE EXISTS (
    SELECT 1 FROM idp_connection_revisions AS r
    WHERE r.project_id = idp_connections.project_id
        AND r.connection_id = idp_connections.id
        AND json_extract(r.document, '$.protocol') = 'oauth2'
);
-- +goose StatementEnd

-- +goose Down
-- No-op: the deleted connections cannot be restored; see the postgres
-- migration.
