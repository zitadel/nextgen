package postgres

import (
	"context"

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

	userPasswordColumns = `id, project_id, user_id, encoded_hash, created_at`

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

	lockUserPasswordStmt = userPasswordQuery + `
WHERE project_id = $1 AND user_id = $2 AND ` + currentUserPassword + `
FOR UPDATE`
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

// LockUserPassword implements [service.UserPasswordStatements].
func (ps userPasswordStatements) LockUserPassword(ctx context.Context, projectID, userID string) (*domain.UserPassword, error) {
	rows, err := ps.client.Query(ctx, lockUserPasswordStmt, projectID, userID)
	if err != nil {
		return nil, wrapError(err)
	}
	pw, err := pgx.CollectExactlyOneRow(rows, ps.scanUserPassword)
	return pw, wrapError(err)
}

func (ps userPasswordStatements) scanUserPassword(row pgx.CollectableRow) (*domain.UserPassword, error) {
	pw := new(domain.UserPassword)
	if err := row.Scan(
		&pw.ID,
		&pw.ProjectID,
		&pw.UserID,
		&pw.EncodedHash,
		&pw.CreatedAt,
	); err != nil {
		return nil, err
	}
	return pw, nil
}

var _ service.UserPasswordStatements = (*userPasswordStatements)(nil)
