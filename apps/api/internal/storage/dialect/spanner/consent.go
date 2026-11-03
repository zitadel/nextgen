package spanner

import (
	"context"

	"cloud.google.com/go/spanner"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/consentstore"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
)

const (
	createConsentStmt = `INSERT INTO consents (
	project_id, id, user_id, client_id, client_name, resource, scope, expires_at
) VALUES (@p1, @p2, @p3, @p4, @p5, @p6, @p7, @p8) THEN RETURN created_at, updated_at`

	consentQuery = `SELECT project_id, id, user_id, client_id, client_name, resource, scope,
	created_at, updated_at, expires_at
FROM consents`

	deleteConsentStmt = `DELETE FROM consents WHERE project_id = @p1 AND id = @p2`

	// The codes and refresh tokens issued under a consent are the
	// oidc_access_token records that name it as their oidc_session_id.
	deleteConsentTokensStmt = `DELETE FROM tokens
WHERE project_id = @p1 AND token_type = 'oidc_access_token' AND oidc_session_id = @p2`

	deleteClientConsentsStmt = `DELETE FROM consents WHERE project_id = @p1 AND client_id = @p2`

	deleteClientConsentTokensStmt = `DELETE FROM tokens
WHERE project_id = @p1 AND token_type = 'oidc_access_token'
	AND oidc_session_id IN (SELECT id FROM consents WHERE project_id = @p1 AND client_id = @p2)`
)

type consentStatements struct{ statement }

func newConsentStatements(db queryExecutor) consentStatements {
	return consentStatements{statement: statement{db: db}}
}

// CreateConsent implements [service.ConsentStatements].
//
// The id is kept once minted: a ReadWriteTransaction retried after an abort
// replays the insert with the same *Consent.
func (s consentStatements) CreateConsent(ctx context.Context, consent *domain.Consent) error {
	if err := ensureManagedID(&consent.ID, domain.PrefixConsent); err != nil {
		return err
	}
	stmt := buildStatement(createConsentStmt,
		consent.ProjectID,
		consent.ID,
		consent.UserID,
		consent.ClientID,
		consent.ClientName,
		consent.Resource,
		consentScope(consent.Scope),
		consent.ExpiresAt,
	).statement()
	return s.db.Write(ctx, stmt, func(iter *spanner.RowIterator) error {
		_, err := collectOneRow(iter, func(row *spanner.Row) (struct{}, error) {
			if err := row.Columns(&consent.CreatedAt, &consent.UpdatedAt); err != nil {
				return struct{}{}, err
			}
			consent.CreatedAt = consent.CreatedAt.UTC()
			consent.UpdatedAt = consent.UpdatedAt.UTC()
			return struct{}{}, nil
		})
		return err
	})
}

// GetConsent implements [service.ConsentStatements].
func (s consentStatements) GetConsent(ctx context.Context, filter database.Filter[domain.ConsentField]) (*domain.Consent, error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, consentQuery, &database.ListOptions[domain.ConsentField]{
		Filter: filter,
	}, consentstore.Schema); err != nil {
		return nil, err
	}
	var consent *domain.Consent
	if err := s.db.Query(ctx, compiler.statement(), func(iter *spanner.RowIterator) error {
		var err error
		consent, err = collectOneRow(iter, scanConsent)
		return err
	}); err != nil {
		return nil, err
	}
	return consent, nil
}

// ListConsents implements [service.ConsentStatements].
func (s consentStatements) ListConsents(ctx context.Context, filter *database.ListOptions[domain.ConsentField]) (*database.ListResult[*domain.Consent], error) {
	consents, nextCursor, err := pagination.Page(filter.Pagination, consentstore.Schema, func(limit uint32) ([]*domain.Consent, error) {
		filter := filter.WithLimit(limit)
		var compiler statementCompiler
		if err := compileRead(&compiler, consentQuery, filter, consentstore.Schema); err != nil {
			return nil, err
		}
		var consents []*domain.Consent
		if err := s.db.Query(ctx, compiler.statement(), func(iter *spanner.RowIterator) error {
			var err error
			consents, err = collectRows(iter, scanConsent)
			return err
		}); err != nil {
			return nil, wrapError(err)
		}
		return consents, nil
	})
	if err != nil {
		return nil, err
	}
	return &database.ListResult[*domain.Consent]{Items: consents, NextCursor: nextCursor}, nil
}

// UpdateConsent implements [service.ConsentStatements].
func (s consentStatements) UpdateConsent(ctx context.Context, projectID, consentID string, update domain.ConsentUpdate) error {
	var c statementCompiler
	c.WriteString("UPDATE consents SET expires_at = ")
	c.WriteArg(update.ExpiresAt)
	if update.ClientName != nil {
		c.WriteString(", client_name = ")
		c.WriteArg(*update.ClientName)
	}
	if update.Scope != nil {
		c.WriteString(", scope = ")
		c.WriteArg(update.Scope)
	}
	c.WriteString(", updated_at = CURRENT_TIMESTAMP() WHERE project_id = ")
	c.WriteArg(projectID)
	c.WriteString(" AND id = ")
	c.WriteArg(consentID)

	n, err := s.db.Update(ctx, c.statement())
	if err != nil {
		return err
	}
	if n == 0 {
		return wrapError(spanner.ErrRowNotFound)
	}
	return nil
}

// DeleteConsent implements [service.ConsentStatements]. The tokens go first,
// as on postgres; a missing consent fails the transaction, which rolls the
// token delete back (inside a caller's transaction, the caller's rollback
// does).
func (s consentStatements) DeleteConsent(ctx context.Context, projectID, consentID string) error {
	return withTransaction(ctx, s.db, func(ctx context.Context, tx queryExecutor) error {
		if _, err := tx.Update(ctx, buildStatement(deleteConsentTokensStmt, projectID, consentID).statement()); err != nil {
			return err
		}
		n, err := tx.Update(ctx, buildStatement(deleteConsentStmt, projectID, consentID).statement())
		if err != nil {
			return err
		}
		if n == 0 {
			return wrapError(spanner.ErrRowNotFound)
		}
		return nil
	})
}

// DeleteConsentsByClient implements [service.ConsentStatements]. The tokens
// go first and are found through the consents the second statement deletes.
func (s consentStatements) DeleteConsentsByClient(ctx context.Context, projectID, clientID string) error {
	return withTransaction(ctx, s.db, func(ctx context.Context, tx queryExecutor) error {
		if _, err := tx.Update(ctx, buildStatement(deleteClientConsentTokensStmt, projectID, clientID).statement()); err != nil {
			return err
		}
		_, err := tx.Update(ctx, buildStatement(deleteClientConsentsStmt, projectID, clientID).statement())
		return err
	})
}

func scanConsent(row *spanner.Row) (*domain.Consent, error) {
	consent := new(domain.Consent)
	var scope []string
	if err := row.Columns(
		&consent.ProjectID,
		&consent.ID,
		&consent.UserID,
		&consent.ClientID,
		&consent.ClientName,
		&consent.Resource,
		&scope,
		&consent.CreatedAt,
		&consent.UpdatedAt,
		&consent.ExpiresAt,
	); err != nil {
		return nil, err
	}
	consent.Scope = consentScope(scope)
	consent.CreatedAt = consent.CreatedAt.UTC()
	consent.UpdatedAt = consent.UpdatedAt.UTC()
	consent.ExpiresAt = consent.ExpiresAt.UTC()
	return consent, nil
}

// consentScope stores and reads an absent scope as an empty one: the column is
// NOT NULL, and every dialect hands back the same empty slice.
func consentScope(scope []string) []string {
	if scope == nil {
		return []string{}
	}
	return scope
}

var _ service.ConsentStatements = (*consentStatements)(nil)
