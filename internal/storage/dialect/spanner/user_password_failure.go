package spanner

import (
	"context"
	"time"

	"cloud.google.com/go/spanner"

	"github.com/zitadel/nextgen/internal/domain"
)

const (
	userPasswordFailuresStmt = `SELECT COUNT(*), MAX(failed_at)
FROM user_password_failures
WHERE project_id = @p1 AND user_id = @p2 AND failed_at > @p3`

	addUserPasswordFailureStmt = `INSERT INTO user_password_failures (
	project_id, id, user_id, failed_at
) VALUES (@p1, @p2, @p3, @p4)`

	deleteUserPasswordFailuresStmt = `DELETE FROM user_password_failures
WHERE project_id = @p1 AND user_id = @p2 AND failed_at <= @p3`
)

// GetUserPasswordFailures implements [service.UserPasswordStatements].
func (ps userPasswordStatements) GetUserPasswordFailures(ctx context.Context, projectID, userID string, since time.Time) (domain.UserPasswordFailures, error) {
	var failures domain.UserPasswordFailures
	stmt := buildStatement(userPasswordFailuresStmt, projectID, userID, since).statement()
	err := ps.db.Query(ctx, stmt, func(iter *spanner.RowIterator) error {
		var err error
		failures, err = collectOneRow(iter, func(row *spanner.Row) (domain.UserPasswordFailures, error) {
			var (
				count int64
				last  spanner.NullTime
			)
			if err := row.Columns(&count, &last); err != nil {
				return domain.UserPasswordFailures{}, err
			}
			return domain.UserPasswordFailures{Count: int(count), LastFailedAt: last.Time}, nil
		})
		return err
	})
	return failures, wrapError(err)
}

// AddUserPasswordFailure implements [service.UserPasswordStatements].
func (ps userPasswordStatements) AddUserPasswordFailure(ctx context.Context, projectID, userID string, at, forgetBefore time.Time) error {
	var id string
	if err := ensureManagedID(&id, domain.PrefixUserPasswordFailure); err != nil {
		return err
	}
	return withTransaction(ctx, ps.db, func(ctx context.Context, tx queryExecutor) error {
		if _, err := tx.Update(ctx, buildStatement(deleteUserPasswordFailuresStmt, projectID, userID, forgetBefore).statement()); err != nil {
			return wrapError(err)
		}
		_, err := tx.Update(ctx, buildStatement(addUserPasswordFailureStmt, projectID, id, userID, at).statement())
		return wrapError(err)
	})
}

// ClearUserPasswordFailures implements [service.UserPasswordStatements].
func (ps userPasswordStatements) ClearUserPasswordFailures(ctx context.Context, projectID, userID string, until time.Time) error {
	_, err := ps.db.Update(ctx, buildStatement(deleteUserPasswordFailuresStmt, projectID, userID, until).statement())
	return wrapError(err)
}
