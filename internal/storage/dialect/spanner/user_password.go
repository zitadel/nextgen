package spanner

import (
	"context"

	"cloud.google.com/go/spanner"

	"github.com/zitadel/zitadel/v5/internal/domain"
	"github.com/zitadel/zitadel/v5/internal/service"
	"github.com/zitadel/zitadel/v5/internal/storage/database"
	"github.com/zitadel/zitadel/v5/internal/storage/dialect/pagination"
	"github.com/zitadel/zitadel/v5/internal/storage/userpassword"
)

const (
	setUserPasswordStmt = `INSERT INTO user_passwords (
	id, project_id, user_id, encoded_hash
) VALUES (@p1, @p2, @p3, @p4)
THEN RETURN id`

	userPasswordColumns = `id, project_id, user_id, encoded_hash, created_at`

	userPasswordQuery = `SELECT ` + userPasswordColumns + `
FROM user_passwords`

	currentUserPassword = `NOT EXISTS (SELECT 1 FROM user_passwords AS newer` +
		` WHERE newer.project_id = user_passwords.project_id` +
		` AND newer.user_id = user_passwords.user_id` +
		` AND newer.created_at > user_passwords.created_at)`

	userPasswordHistoryQuery = `SELECT ` + userPasswordColumns + `
FROM user_passwords
WHERE project_id = @p1 AND user_id = @p2
ORDER BY created_at DESC
LIMIT @p3 OFFSET 1`
)

type userPasswordStatements struct{ statement }

func newUserPasswordStatements(db queryExecutor) userPasswordStatements {
	return userPasswordStatements{
		statement: statement{
			db: db,
		},
	}
}

// SetUserPassword implements [service.UserPasswordStatements].
func (ps userPasswordStatements) SetUserPassword(ctx context.Context, pw *domain.SetUserPassword) error {
	if err := ensureManagedID(&pw.ID, domain.PrefixUserPassword); err != nil {
		return err
	}
	stmt := buildStatement(setUserPasswordStmt,
		pw.ID,
		pw.ProjectID,
		pw.UserID,
		pw.EncodedHash,
	).statement()
	return ps.db.Write(ctx, stmt, func(iter *spanner.RowIterator) error {
		id, err := collectOneRow(iter, func(row *spanner.Row) (string, error) {
			var id string
			if err := row.Columns(&id); err != nil {
				return "", err
			}
			return id, nil
		})
		if err != nil {
			return err
		}
		pw.ID = id
		return nil
	})
}

// GetUserPassword implements [service.UserPasswordStatements].
func (ps userPasswordStatements) GetUserPassword(ctx context.Context, filter database.Filter[domain.UserPasswordField]) (*domain.UserPassword, error) {
	result, err := ps.ListUserPasswords(ctx, &database.ListOptions[domain.UserPasswordField]{Filter: filter})
	if err != nil {
		return nil, err
	}
	switch len(result.Items) {
	case 0:
		return nil, wrapError(spanner.ErrRowNotFound)
	case 1:
		return result.Items[0], nil
	default:
		return nil, wrapError(errTooManyRows)
	}
}

// ListUserPasswords implements [service.UserPasswordStatements].
func (ps userPasswordStatements) ListUserPasswords(ctx context.Context, filter *database.ListOptions[domain.UserPasswordField]) (*database.ListResult[*domain.UserPassword], error) {
	passwords, nextCursor, err := pagination.Page(filter.Pagination, userpassword.Schema, func(limit uint32) ([]*domain.UserPassword, error) {
		filter := filter.WithLimit(limit)
		var compiler statementCompiler
		if err := compileRead(&compiler, userPasswordQuery, filter, userpassword.Schema, currentUserPassword); err != nil {
			return nil, err
		}

		var passwords []*domain.UserPassword
		err := ps.db.Query(ctx, compiler.statement(), func(iter *spanner.RowIterator) error {
			var err error
			passwords, err = collectRows(iter, ps.scanUserPassword)
			return err
		})
		if err != nil {
			return nil, wrapError(err)
		}

		return passwords, nil
	})
	if err != nil {
		return nil, err
	}
	return &database.ListResult[*domain.UserPassword]{
		Items:      passwords,
		NextCursor: nextCursor,
	}, nil
}

// GetUserPasswordHistory implements [service.UserPasswordStatements].
func (ps userPasswordStatements) GetUserPasswordHistory(ctx context.Context, projectID, userID string) ([]*domain.UserPassword, error) {
	var passwords []*domain.UserPassword
	stmt := buildStatement(userPasswordHistoryQuery, projectID, userID, int64(domain.UserPasswordHistoryDepth)).statement()
	err := ps.db.Query(ctx, stmt, func(iter *spanner.RowIterator) error {
		var err error
		passwords, err = collectRows(iter, ps.scanUserPassword)
		return err
	})
	return passwords, wrapError(err)
}

func (ps userPasswordStatements) scanUserPassword(row *spanner.Row) (*domain.UserPassword, error) {
	pw := new(domain.UserPassword)
	if err := row.Columns(
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
