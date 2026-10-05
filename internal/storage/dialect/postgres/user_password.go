package postgres

import (
	"context"
	"database/sql"

	"github.com/jackc/pgx/v5"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
	"github.com/zitadel/nextgen/internal/storage/userpassword"
)

const (
	setUserPasswordStmt = `INSERT INTO zitadel_nextgen.user_passwords (
	id, project_id, user_id, encoded_hash, created_at
) SELECT $1, $2, $3, $4, stamp.at
FROM (SELECT clock_timestamp() AS at) AS stamp
RETURNING id`

	userPasswordColumns = `id, project_id, user_id, encoded_hash, created_at, failed_attempts, last_failed_at`

	userPasswordQuery = `SELECT ` + userPasswordColumns + `
FROM zitadel_nextgen.user_passwords`

	currentUserPassword = `NOT EXISTS (SELECT 1 FROM zitadel_nextgen.user_passwords newer` +
		` WHERE newer.project_id = user_passwords.project_id` +
		` AND newer.user_id = user_passwords.user_id` +
		` AND newer.created_at > user_passwords.created_at)`

	userPasswordHistoryQuery = `SELECT ` + userPasswordColumns + `
FROM zitadel_nextgen.user_passwords
WHERE project_id = $1 AND user_id = $2
ORDER BY created_at DESC
LIMIT $3 OFFSET 1`

	updatePasswordVerificationFailuresStmt = `UPDATE zitadel_nextgen.user_passwords SET
	failed_attempts = $3,
	last_failed_at = $4
WHERE project_id = $1 AND id = $2`
)

type userPasswordStatements struct{ statement }

func newUserPasswordStatements(client queryExecutor) userPasswordStatements {
	return userPasswordStatements{
		statement: statement{
			client: client,
		},
	}
}

// SetUserPassword implements [service.UserPasswordStatements].
func (ps userPasswordStatements) SetUserPassword(ctx context.Context, pw *domain.SetUserPassword) error {
	if err := ensureManagedID(&pw.ID, domain.PrefixUserPassword); err != nil {
		return err
	}
	err := ps.client.QueryRow(ctx, setUserPasswordStmt,
		pw.ID,
		pw.ProjectID,
		pw.UserID,
		pw.EncodedHash,
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
		return nil, wrapError(pgx.ErrNoRows)
	case 1:
		return result.Items[0], nil
	default:
		return nil, wrapError(pgx.ErrTooManyRows)
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

	passwords, err := pgx.CollectRows(rows, ps.scanUserPassword)
	if err != nil {
		return nil, wrapError(err)
	}

	nextCursor := pagination.MarshalNext(
		filter.Pagination.OrderBy,
		passwords,
		userpassword.Schema,
		filter.Pagination.Limit,
	)

	return &database.ListResult[*domain.UserPassword]{
		Items:      passwords,
		NextCursor: nextCursor,
	}, nil
}

// GetUserPasswordHistory implements [service.UserPasswordStatements].
func (ps userPasswordStatements) GetUserPasswordHistory(ctx context.Context, projectID, userID string) ([]*domain.UserPassword, error) {
	rows, err := ps.client.Query(ctx, userPasswordHistoryQuery, projectID, userID, domain.UserPasswordHistoryDepth)
	if err != nil {
		return nil, wrapError(err)
	}
	passwords, err := pgx.CollectRows(rows, ps.scanUserPassword)
	return passwords, wrapError(err)
}

// UpdatePasswordVerificationFailures implements [service.UserPasswordStatements].
func (ps userPasswordStatements) UpdatePasswordVerificationFailures(ctx context.Context, pw *domain.UserPassword) error {
	var lastFailedAt sql.NullTime
	if !pw.LastFailedAt.IsZero() {
		lastFailedAt = sql.NullTime{Time: pw.LastFailedAt, Valid: true}
	}
	tag, err := ps.client.Exec(ctx, updatePasswordVerificationFailuresStmt,
		pw.ProjectID,
		pw.ID,
		int16(pw.FailedAttemptCount),
		lastFailedAt,
	)
	if err != nil {
		return wrapError(err)
	}
	if tag.RowsAffected() == 0 {
		return wrapError(pgx.ErrNoRows)
	}
	return nil
}

func (ps userPasswordStatements) scanUserPassword(row pgx.CollectableRow) (*domain.UserPassword, error) {
	pw := new(domain.UserPassword)
	var (
		failedAttempts int16
		lastFailedAt   sql.NullTime
	)
	if err := row.Scan(
		&pw.ID,
		&pw.ProjectID,
		&pw.UserID,
		&pw.EncodedHash,
		&pw.CreatedAt,
		&failedAttempts,
		&lastFailedAt,
	); err != nil {
		return nil, err
	}
	pw.FailedAttemptCount = int(failedAttempts)
	if lastFailedAt.Valid {
		pw.LastFailedAt = lastFailedAt.Time
	}
	return pw, nil
}

var _ service.UserPasswordStatements = (*userPasswordStatements)(nil)
