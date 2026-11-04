package postgres

import (
	"context"

	"github.com/jackc/pgx/v5"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/consentstore"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
)

const (
	createConsentStmt = `INSERT INTO zitadel_nextgen.consents (
	project_id, id, user_id, client_id, client_name, resource, scope, expires_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING created_at, updated_at`

	consentQuery = `SELECT project_id, id, user_id, client_id, client_name, resource, scope,
	created_at, updated_at, expires_at
FROM zitadel_nextgen.consents`

	deleteConsentStmt = `DELETE FROM zitadel_nextgen.consents WHERE project_id = $1 AND id = $2`

	// The codes and refresh tokens issued under a consent are the
	// oidc_access_token records that name it as their oidc_session_id.
	deleteConsentTokensStmt = `DELETE FROM zitadel_nextgen.tokens
WHERE project_id = $1
	AND token_type = 'oidc_access_token'::zitadel_nextgen.token_types
	AND oidc_session_id = $2`

	deleteClientConsentsStmt = `DELETE FROM zitadel_nextgen.consents WHERE project_id = $1 AND client_id = $2`

	deleteClientConsentTokensStmt = `DELETE FROM zitadel_nextgen.tokens
WHERE project_id = $1
	AND token_type = 'oidc_access_token'::zitadel_nextgen.token_types
	AND oidc_session_id IN (
		SELECT id FROM zitadel_nextgen.consents WHERE project_id = $1 AND client_id = $2
	)`
)

type consentStatements struct{ statement }

func newConsentStatements(client queryExecutor) consentStatements {
	return consentStatements{statement: statement{client: client}}
}

// CreateConsent implements [service.ConsentStatements].
func (s consentStatements) CreateConsent(ctx context.Context, consent *domain.Consent) error {
	if err := ensureManagedID(&consent.ID, domain.PrefixConsent); err != nil {
		return err
	}
	if err := s.client.QueryRow(ctx, createConsentStmt,
		consent.ProjectID,
		consent.ID,
		consent.UserID,
		consent.ClientID,
		consent.ClientName,
		consent.Resource,
		consentScope(consent.Scope),
		consent.ExpiresAt,
	).Scan(&consent.CreatedAt, &consent.UpdatedAt); err != nil {
		return wrapError(err)
	}
	// pgx scans timestamptz in Local; reads normalize to UTC.
	consent.CreatedAt = consent.CreatedAt.UTC()
	consent.UpdatedAt = consent.UpdatedAt.UTC()
	return nil
}

// GetConsent implements [service.ConsentStatements].
func (s consentStatements) GetConsent(ctx context.Context, filter database.Filter[domain.ConsentField]) (*domain.Consent, error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, consentQuery, &database.ListOptions[domain.ConsentField]{
		Filter: filter,
	}, consentstore.Schema); err != nil {
		return nil, err
	}
	rows, err := s.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}
	consent, err := pgx.CollectExactlyOneRow(rows, scanConsent)
	if err != nil {
		return nil, wrapError(err)
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
		rows, err := s.client.Query(ctx, compiler.String(), compiler.args...)
		if err != nil {
			return nil, wrapError(err)
		}
		consents, err := pgx.CollectRows(rows, scanConsent)
		if err != nil {
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
	c.WriteString("UPDATE zitadel_nextgen.consents SET expires_at = ")
	c.WriteArg(update.ExpiresAt)
	if update.ClientName != nil {
		c.WriteString(", client_name = ")
		c.WriteArg(*update.ClientName)
	}
	if update.Scope != nil {
		c.WriteString(", scope = ")
		c.WriteArg(update.Scope)
	}
	c.WriteString(", updated_at = now() WHERE project_id = ")
	c.WriteArg(projectID)
	c.WriteString(" AND id = ")
	c.WriteArg(consentID)

	tag, err := s.client.Exec(ctx, c.String(), c.args...)
	if err != nil {
		return wrapError(err)
	}
	if tag.RowsAffected() == 0 {
		return wrapError(pgx.ErrNoRows)
	}
	return nil
}

// DeleteConsent implements [service.ConsentStatements].
//
// The tokens go first, so the statement takes its locks in the order a refresh
// takes them (the token it uses up, then the consent whose deadline it moves)
// and the two cannot deadlock. A missing consent fails the transaction, which
// rolls the token delete back.
func (s consentStatements) DeleteConsent(ctx context.Context, projectID, consentID string) error {
	return withTransaction(ctx, s.client, func(ctx context.Context, tx queryExecutor) error {
		if _, err := tx.Exec(ctx, deleteConsentTokensStmt, projectID, consentID); err != nil {
			return wrapError(err)
		}
		tag, err := tx.Exec(ctx, deleteConsentStmt, projectID, consentID)
		if err != nil {
			return wrapError(err)
		}
		if tag.RowsAffected() == 0 {
			return wrapError(pgx.ErrNoRows)
		}
		return nil
	})
}

// DeleteConsentsByClient implements [service.ConsentStatements]. The tokens
// go first, as in [consentStatements.DeleteConsent], and are found through
// the consents the second statement deletes.
func (s consentStatements) DeleteConsentsByClient(ctx context.Context, projectID, clientID string) error {
	return withTransaction(ctx, s.client, func(ctx context.Context, tx queryExecutor) error {
		if _, err := tx.Exec(ctx, deleteClientConsentTokensStmt, projectID, clientID); err != nil {
			return wrapError(err)
		}
		if _, err := tx.Exec(ctx, deleteClientConsentsStmt, projectID, clientID); err != nil {
			return wrapError(err)
		}
		return nil
	})
}

func scanConsent(row pgx.CollectableRow) (*domain.Consent, error) {
	consent := new(domain.Consent)
	var scope []string
	if err := row.Scan(
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
