package sqlite

import (
	"context"
	"database/sql"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
)

const (
	userPasswordFailuresStmt = `SELECT COUNT(*), MAX(failed_at)
FROM user_password_failures
WHERE project_id = ? AND user_id = ? AND failed_at > ?`

	addUserPasswordFailureStmt = `INSERT INTO user_password_failures (
	project_id, id, user_id, failed_at
) VALUES (?, ?, ?, ?)`

	deleteUserPasswordFailuresStmt = `DELETE FROM user_password_failures
WHERE project_id = ? AND user_id = ? AND failed_at <= ?`
)

// GetUserPasswordFailures implements [service.UserPasswordStatements].
func (ps userPasswordStatements) GetUserPasswordFailures(ctx context.Context, projectID, userID string, since time.Time) (domain.UserPasswordFailures, error) {
	var (
		count    int64
		lastNano sql.NullInt64
	)
	if err := ps.client.QueryRow(ctx, userPasswordFailuresStmt, projectID, userID, since.UnixNano()).Scan(&count, &lastNano); err != nil {
		return domain.UserPasswordFailures{}, wrapError(err)
	}
	failures := domain.UserPasswordFailures{Count: int(count)}
	if lastNano.Valid {
		failures.LastFailedAt = timeFromUnixNano(lastNano.Int64)
	}
	return failures, nil
}

// AddUserPasswordFailure implements [service.UserPasswordStatements].
func (ps userPasswordStatements) AddUserPasswordFailure(ctx context.Context, projectID, userID string, at, forgetBefore time.Time) error {
	var id string
	if err := ensureManagedID(&id, domain.PrefixUserPasswordFailure); err != nil {
		return err
	}
	return withTransaction(ctx, ps.client, func(ctx context.Context, tx queryExecutor) error {
		if _, err := tx.Exec(ctx, deleteUserPasswordFailuresStmt, projectID, userID, forgetBefore.UnixNano()); err != nil {
			return wrapError(err)
		}
		_, err := tx.Exec(ctx, addUserPasswordFailureStmt, projectID, id, userID, at.UnixNano())
		return wrapError(err)
	})
}

// ClearUserPasswordFailures implements [service.UserPasswordStatements].
func (ps userPasswordStatements) ClearUserPasswordFailures(ctx context.Context, projectID, userID string, until time.Time) error {
	_, err := ps.client.Exec(ctx, deleteUserPasswordFailuresStmt, projectID, userID, until.UnixNano())
	return wrapError(err)
}
