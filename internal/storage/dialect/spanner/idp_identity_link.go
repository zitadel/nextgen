package spanner

import (
	"context"

	"cloud.google.com/go/spanner"

	"github.com/zitadel/zitadel/v5/internal/domain"
	"github.com/zitadel/zitadel/v5/internal/service"
	"github.com/zitadel/zitadel/v5/internal/storage/database"
	"github.com/zitadel/zitadel/v5/internal/storage/idpidentitylink"
)

const (
	createIDPIdentityLinkStmt = `INSERT INTO idp_identity_links ` +
		`(project_id, id, connection_id, subject, user_id) VALUES (@p1, @p2, @p3, @p4, @p5) THEN RETURN created_at`

	idpIdentityLinkQuery = `SELECT project_id, id, connection_id, subject, user_id, created_at
FROM idp_identity_links`
)

type idpIdentityLinkStatements struct{ statement }

func newIDPIdentityLinkStatements(db queryExecutor) idpIdentityLinkStatements {
	return idpIdentityLinkStatements{statement: statement{db: db}}
}

// CreateIDPIdentityLink implements [service.IDPIdentityLinkStatements].
func (s idpIdentityLinkStatements) CreateIDPIdentityLink(ctx context.Context, link *domain.IDPIdentityLink) error {
	if err := ensureManagedID(&link.ID, domain.PrefixIDPIdentityLink); err != nil {
		return err
	}
	stmt := buildStatement(createIDPIdentityLinkStmt,
		link.ProjectID,
		link.ID,
		link.ConnectionID,
		link.Subject,
		link.UserID,
	).statement()
	return s.db.Write(ctx, stmt, scanReturnedTimestamp(&link.CreatedAt))
}

// GetIDPIdentityLink implements [service.IDPIdentityLinkStatements].
func (s idpIdentityLinkStatements) GetIDPIdentityLink(ctx context.Context, filter database.Filter[domain.IDPIdentityLinkField]) (*domain.IDPIdentityLink, error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, idpIdentityLinkQuery, &database.ListOptions[domain.IDPIdentityLinkField]{
		Filter: filter,
	}, idpidentitylink.Schema); err != nil {
		return nil, err
	}
	var link *domain.IDPIdentityLink
	if err := s.db.Query(ctx, compiler.statement(), func(iter *spanner.RowIterator) error {
		var err error
		link, err = collectOneRow(iter, scanIDPIdentityLink)
		return err
	}); err != nil {
		return nil, err
	}
	return link, nil
}

func scanIDPIdentityLink(row *spanner.Row) (*domain.IDPIdentityLink, error) {
	var link domain.IDPIdentityLink
	if err := row.Columns(
		&link.ProjectID,
		&link.ID,
		&link.ConnectionID,
		&link.Subject,
		&link.UserID,
		&link.CreatedAt,
	); err != nil {
		return nil, err
	}
	link.CreatedAt = link.CreatedAt.UTC()
	return &link, nil
}

var _ service.IDPIdentityLinkStatements = (*idpIdentityLinkStatements)(nil)
