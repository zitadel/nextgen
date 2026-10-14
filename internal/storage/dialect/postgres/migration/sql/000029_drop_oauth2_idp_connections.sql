-- +goose Up
-- OAuth 2.0 identity provider connections are no longer supported: only OIDC
-- remains, and a revision whose document names protocol oauth2 can no longer be
-- decoded or served, so reading one would fail. Such connections are deleted
-- with every row that would block that delete or be left dangling by it. The
-- protocol is immutable per connection, so any revision naming oauth2 marks the
-- whole connection.

-- Links go first: their connection FK is NO ACTION (000025).
DELETE FROM zitadel_nextgen.idp_identity_links AS l
WHERE EXISTS (
    SELECT 1 FROM zitadel_nextgen.idp_connection_revisions AS r
    WHERE r.project_id = l.project_id
        AND r.connection_id = l.connection_id
        AND r.document ->> 'protocol' = 'oauth2'
);

-- The scope index has no FK to the connection, so nothing cascades its row.
-- It goes before the connection, while the revisions still identify it.
DELETE FROM zitadel_nextgen.resource_scope_index AS s
WHERE s.resource_kind = 'idp_connection'
    AND EXISTS (
        SELECT 1 FROM zitadel_nextgen.idp_connection_revisions AS r
        WHERE r.project_id = s.project_id
            AND r.connection_id = s.resource_id
            AND r.document ->> 'protocol' = 'oauth2'
    );

-- The revisions cascade from the connection (000022).
DELETE FROM zitadel_nextgen.idp_connections AS c
WHERE EXISTS (
    SELECT 1 FROM zitadel_nextgen.idp_connection_revisions AS r
    WHERE r.project_id = c.project_id
        AND r.connection_id = c.id
        AND r.document ->> 'protocol' = 'oauth2'
);

-- +goose Down
-- No-op: the deleted connections cannot be restored.
