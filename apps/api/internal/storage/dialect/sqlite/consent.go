package sqlite

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/consentstore"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
)

const (
	createConsentStmt = `INSERT INTO consents (
	project_id, id, user_id, client_id, client_name, resource, scope, created_at, updated_at, expires_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

	consentQuery = `SELECT project_id, id, user_id, client_id, client_name, resource, scope,
	created_at, updated_at, expires_at
FROM consents`

	deleteConsentStmt = `DELETE FROM consents WHERE project_id = ? AND id = ?`

	// The codes and refresh tokens issued under a consent are the
	// oidc_access_token records that name it as their oidc_session_id.
	deleteConsentTokensStmt = `DELETE FROM tokens
WHERE project_id = ? AND token_type = 'oidc_access_token' AND oidc_session_id = ?`

	deleteClientConsentsStmt = `DELETE FROM consents WHERE project_id = ? AND client_id = ?`

	deleteClientConsentTokensStmt = `DELETE FROM tokens
WHERE project_id = ? AND token_type = 'oidc_access_token'
	AND oidc_session_id IN (SELECT id FROM consents WHERE project_id = ? AND client_id = ?)`
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
	// encodeJSON stores an absent scope as an empty array.
	scope, err := encodeJSON(consent.Scope)
	if err != nil {
		return wrapError(err)
	}
	now := nowUnixNano()
	if _, err := s.client.Exec(ctx, createConsentStmt,
		consent.ProjectID,
		consent.ID,
		consent.UserID,
		consent.ClientID,
		consent.ClientName,
		consent.Resource,
		scope,
		now,
		now,
		consent.ExpiresAt.UnixNano(),
	); err != nil {
		return wrapError(err)
	}
	consent.CreatedAt = timeFromUnixNano(now)
	consent.UpdatedAt = consent.CreatedAt
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
	defer rows.Close()
	consent, err := collectExactlyOneRow(rows, scanConsent)
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
		defer rows.Close()
		consents, err := collectRows(rows, scanConsent)
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
	c.WriteString("UPDATE consents SET expires_at = ")
	c.WriteArg(update.ExpiresAt)
	if update.ClientName != nil {
		c.WriteString(", client_name = ")
		c.WriteArg(*update.ClientName)
	}
	if update.Scope != nil {
		scope, err := encodeJSON(update.Scope)
		if err != nil {
			return wrapError(err)
		}
		c.WriteString(", scope = ")
		c.WriteArg(scope)
	}
	c.WriteString(", updated_at = ")
	c.WriteArg(nowUnixNano())
	c.WriteString(" WHERE project_id = ")
	c.WriteArg(projectID)
	c.WriteString(" AND id = ")
	c.WriteArg(consentID)

	n, err := execAffected(ctx, s.client, c.String(), c.args...)
	if err != nil {
		return err
	}
	if n == 0 {
		return database.NewNoRowFoundError(nil)
	}
	return nil
}

// DeleteConsent implements [service.ConsentStatements]. The tokens go first,
// as on postgres; a missing consent fails the transaction, which rolls the
// token delete back (inside a caller's transaction, the caller's rollback
// does).
func (s consentStatements) DeleteConsent(ctx context.Context, projectID, consentID string) error {
	return withTransaction(ctx, s.client, func(ctx context.Context, tx queryExecutor) error {
		if _, err := tx.Exec(ctx, deleteConsentTokensStmt, projectID, consentID); err != nil {
			return wrapError(err)
		}
		n, err := execAffected(ctx, tx, deleteConsentStmt, projectID, consentID)
		if err != nil {
			return err
		}
		if n == 0 {
			return database.NewNoRowFoundError(nil)
		}
		return nil
	})
}

// DeleteConsentsByClient implements [service.ConsentStatements]. The tokens
// go first and are found through the consents the second statement deletes.
func (s consentStatements) DeleteConsentsByClient(ctx context.Context, projectID, clientID string) error {
	return withTransaction(ctx, s.client, func(ctx context.Context, tx queryExecutor) error {
		if _, err := tx.Exec(ctx, deleteClientConsentTokensStmt, projectID, projectID, clientID); err != nil {
			return wrapError(err)
		}
		if _, err := tx.Exec(ctx, deleteClientConsentsStmt, projectID, clientID); err != nil {
			return wrapError(err)
		}
		return nil
	})
}

func scanConsent(rows *sql.Rows) (*domain.Consent, error) {
	var (
		consent                               domain.Consent
		scope                                 string
		createdNano, updatedNano, expiresNano int64
	)
	if err := rows.Scan(
		&consent.ProjectID,
		&consent.ID,
		&consent.UserID,
		&consent.ClientID,
		&consent.ClientName,
		&consent.Resource,
		&scope,
		&createdNano,
		&updatedNano,
		&expiresNano,
	); err != nil {
		return nil, err
	}
	decoded, err := decodeJSONStrings(scope)
	if err != nil {
		return nil, fmt.Errorf("decode consent scope: %w", err)
	}
	consent.Scope = decoded
	consent.CreatedAt = timeFromUnixNano(createdNano)
	consent.UpdatedAt = timeFromUnixNano(updatedNano)
	consent.ExpiresAt = timeFromUnixNano(expiresNano)
	return &consent, nil
}

var _ service.ConsentStatements = (*consentStatements)(nil)
