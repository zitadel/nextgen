package sqlite

import (
	"context"
	"database/sql"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
	"github.com/zitadel/nextgen/internal/storage/userpassword"
)

const (
	setUserPasswordStmt = `INSERT INTO user_passwords (
	project_id, id, user_id, encoded_hash, created_at
) VALUES (?, ?, ?, ?, ?)
RETURNING id`

	userPasswordColumns = `id, project_id, user_id, encoded_hash, created_at`

	userPasswordQuery = `SELECT ` + userPasswordColumns + `
FROM user_passwords`

	currentUserPassword = `NOT EXISTS (SELECT 1 FROM user_passwords AS newer` +
		` WHERE newer.project_id = user_passwords.project_id` +
		` AND newer.user_id = user_passwords.user_id` +
		` AND newer.created_at > user_passwords.created_at)`

	userPasswordHistoryQuery = `SELECT ` + userPasswordColumns + `
FROM user_passwords
WHERE project_id = ? AND user_id = ?
ORDER BY created_at DESC
LIMIT ? OFFSET 1`
)

type userPasswordStatements struct{ statement }

func newUserPasswordStatements(client queryExecutor) userPasswordStatements {
	return userPasswordStatements{statement: statement{client: client}}
}

// SetUserPassword implements [service.UserPasswordStatements].
func (ps userPasswordStatements) SetUserPassword(ctx context.Context, pw *domain.SetUserPassword) error {
	if err := ensureManagedID(&pw.ID, domain.PrefixUserPassword); err != nil {
		return err
	}
	now := nowUnixNano()
	err := ps.client.QueryRow(ctx, setUserPasswordStmt,
		pw.ProjectID,
		pw.ID,
		pw.UserID,
		pw.EncodedHash,
		now,
	).Scan(&pw.ID)
	return wrapError(err)
}

// GetUserPassword implements [service.UserPasswordStatements].
func (ps userPasswordStatements) GetUserPassword(ctx context.Context, filter database.Filter[domain.UserPasswordField]) (*domain.UserPassword, error) {
	result, err := ps.ListUserPasswords(ctx, &database.ListOptions[domain.UserPasswordField]{Filter: filter})
	if err != nil {
		return nil, err
	}
	switch len(result.Items) {
	case 0:
		return nil, database.NewNoRowFoundError(nil)
	case 1:
		return result.Items[0], nil
	default:
		return nil, database.NewMultipleRowsFoundError(nil)
	}
}

// ListUserPasswords implements [service.UserPasswordStatements].
func (ps userPasswordStatements) ListUserPasswords(ctx context.Context, filter *database.ListOptions[domain.UserPasswordField]) (*database.ListResult[*domain.UserPassword], error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, userPasswordQuery, filter, userpassword.Schema, currentUserPassword); err != nil {
		return nil, err
	}
	rows, err := ps.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}
	defer rows.Close()
	passwords, err := collectRows(rows, scanUserPassword)
	if err != nil {
		return nil, wrapError(err)
	}
	nextCursor := pagination.MarshalNext(
		filter.Pagination.OrderBy,
		passwords,
		userpassword.Schema,
		filter.Pagination.Limit,
	)
	return &database.ListResult[*domain.UserPassword]{Items: passwords, NextCursor: nextCursor}, nil
}

// GetUserPasswordHistory implements [service.UserPasswordStatements].
func (ps userPasswordStatements) GetUserPasswordHistory(ctx context.Context, projectID, userID string) ([]*domain.UserPassword, error) {
	rows, err := ps.client.Query(ctx, userPasswordHistoryQuery, projectID, userID, domain.UserPasswordHistoryDepth)
	if err != nil {
		return nil, wrapError(err)
	}
	defer rows.Close()
	passwords, err := collectRows(rows, scanUserPassword)
	return passwords, wrapError(err)
}

func scanUserPassword(rows *sql.Rows) (*domain.UserPassword, error) {
	pw := new(domain.UserPassword)
	var createdNano int64
	if err := rows.Scan(
		&pw.ID,
		&pw.ProjectID,
		&pw.UserID,
		&pw.EncodedHash,
		&createdNano,
	); err != nil {
		return nil, err
	}
	pw.CreatedAt = timeFromUnixNano(createdNano)
	return pw, nil
}

var _ service.UserPasswordStatements = (*userPasswordStatements)(nil)
