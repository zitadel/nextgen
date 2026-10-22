package postgres

import (
	"context"

	"github.com/jackc/pgx/v5"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
	"github.com/zitadel/nextgen/internal/storage/idpidentitylink"
)

const (
	createIDPIdentityLinkStmt = `INSERT INTO zitadel_nextgen.idp_identity_links ` +
		`(project_id, id, connection_id, subject, user_id) VALUES ($1, $2, $3, $4, $5) RETURNING created_at`

	idpIdentityLinkQuery = `SELECT project_id, id, connection_id, subject, user_id, created_at
FROM zitadel_nextgen.idp_identity_links`
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
	if err := s.client.QueryRow(ctx, createIDPIdentityLinkStmt,
		link.ProjectID,
		link.ID,
		link.ConnectionID,
		link.Subject,
		link.UserID,
	).Scan(&link.CreatedAt); err != nil {
		return wrapError(err)
	}
	// pgx scans timestamptz in Local; reads normalize to UTC.
	link.CreatedAt = link.CreatedAt.UTC()
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
	link, err := pgx.CollectExactlyOneRow(rows, scanIDPIdentityLink)
	if err != nil {
		return nil, wrapError(err)
	}
	return link, nil
}

// ListIDPIdentityLinks implements [service.IDPIdentityLinkStatements].
func (s idpIdentityLinkStatements) ListIDPIdentityLinks(ctx context.Context, filter *database.ListOptions[domain.IDPIdentityLinkField]) (*database.ListResult[*domain.IDPIdentityLink], error) {
	links, nextCursor, err := pagination.Page(filter.Pagination, idpidentitylink.Schema, func(limit uint32) ([]*domain.IDPIdentityLink, error) {
		filter := filter.WithLimit(limit)
		var compiler statementCompiler
		if err := compileRead(&compiler, idpIdentityLinkQuery, filter, idpidentitylink.Schema); err != nil {
			return nil, err
		}
		rows, err := s.client.Query(ctx, compiler.String(), compiler.args...)
		if err != nil {
			return nil, wrapError(err)
		}
		links, err := pgx.CollectRows(rows, scanIDPIdentityLink)
		if err != nil {
			return nil, wrapError(err)
		}
		return links, nil
	})
	if err != nil {
		return nil, err
	}
	return &database.ListResult[*domain.IDPIdentityLink]{Items: links, NextCursor: nextCursor}, nil
}

func scanIDPIdentityLink(row pgx.CollectableRow) (*domain.IDPIdentityLink, error) {
	link := new(domain.IDPIdentityLink)
	if err := row.Scan(
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
	return link, nil
}

var _ service.IDPIdentityLinkStatements = (*idpIdentityLinkStatements)(nil)
