package sqlite

import (
	"context"
	"database/sql"

	"github.com/zitadel/zitadel/v5/internal/domain"
	"github.com/zitadel/zitadel/v5/internal/service"
	"github.com/zitadel/zitadel/v5/internal/storage/database"
	"github.com/zitadel/zitadel/v5/internal/storage/idpidentitylink"
)

const (
	createIDPIdentityLinkStmt = `INSERT INTO idp_identity_links ` +
		`(project_id, id, connection_id, subject, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`

	idpIdentityLinkQuery = `SELECT project_id, id, connection_id, subject, user_id, created_at
FROM idp_identity_links`
)

type idpIdentityLinkStatements struct{ statement }

func newIDPIdentityLinkStatements(client queryExecutor) idpIdentityLinkStatements {
	return idpIdentityLinkStatements{statement: statement{client: client}}
}

// CreateIDPIdentityLink implements [service.IDPIdentityLinkStatements].
func (s idpIdentityLinkStatements) CreateIDPIdentityLink(ctx context.Context, link *domain.IDPIdentityLink) error {
	if err := ensureManagedID(&link.ID, domain.PrefixIDPIdentityLink); err != nil {
		return err
	}
	now := nowUnixNano()
	if _, err := s.client.Exec(ctx, createIDPIdentityLinkStmt,
		link.ProjectID,
		link.ID,
		link.ConnectionID,
		link.Subject,
		link.UserID,
		now,
	); err != nil {
		return wrapError(err)
	}
	link.CreatedAt = timeFromUnixNano(now)
	return nil
}

// GetIDPIdentityLink implements [service.IDPIdentityLinkStatements].
func (s idpIdentityLinkStatements) GetIDPIdentityLink(ctx context.Context, filter database.Filter[domain.IDPIdentityLinkField]) (*domain.IDPIdentityLink, error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, idpIdentityLinkQuery, &database.ListOptions[domain.IDPIdentityLinkField]{
		Filter: filter,
	}, idpidentitylink.Schema); err != nil {
		return nil, err
	}
	rows, err := s.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}
	defer rows.Close()
	link, err := collectExactlyOneRow(rows, scanIDPIdentityLink)
	if err != nil {
		return nil, wrapError(err)
	}
	return link, nil
}

func scanIDPIdentityLink(rows *sql.Rows) (*domain.IDPIdentityLink, error) {
	var (
		link        domain.IDPIdentityLink
		createdNano int64
	)
	if err := rows.Scan(
		&link.ProjectID,
		&link.ID,
		&link.ConnectionID,
		&link.Subject,
		&link.UserID,
		&createdNano,
	); err != nil {
		return nil, err
	}
	link.CreatedAt = timeFromUnixNano(createdNano)
	return &link, nil
}

var _ service.IDPIdentityLinkStatements = (*idpIdentityLinkStatements)(nil)
