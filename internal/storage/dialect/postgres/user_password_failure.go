package postgres

import (
	"context"
	"database/sql"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
)

const (
	userPasswordFailuresStmt = `SELECT COUNT(*), MAX(failed_at)
FROM zitadel_nextgen.user_password_failures
WHERE project_id = $1 AND user_id = $2 AND failed_at > $3`

	addUserPasswordFailureStmt = `INSERT INTO zitadel_nextgen.user_password_failures (
	project_id, id, user_id, failed_at
) VALUES ($1, $2, $3, $4)`

	deleteUserPasswordFailuresStmt = `DELETE FROM zitadel_nextgen.user_password_failures
WHERE project_id = $1 AND user_id = $2 AND failed_at <= $3`
)

// GetUserPasswordFailures implements [service.UserPasswordStatements].
func (ps userPasswordStatements) GetUserPasswordFailures(ctx context.Context, projectID, userID string, since time.Time) (domain.UserPasswordFailures, error) {
	var (
		count int64
		last  sql.NullTime
	)
	if err := ps.client.QueryRow(ctx, userPasswordFailuresStmt, projectID, userID, since).Scan(&count, &last); err != nil {
		return domain.UserPasswordFailures{}, wrapError(err)
	}
	return domain.UserPasswordFailures{Count: int(count), LastFailedAt: last.Time}, nil
}

// AddUserPasswordFailure implements [service.UserPasswordStatements].
func (ps userPasswordStatements) AddUserPasswordFailure(ctx context.Context, projectID, userID string, at, forgetBefore time.Time) error {
	var id string
	if err := ensureManagedID(&id, domain.PrefixUserPasswordFailure); err != nil {
		return err
	}
	return withTransaction(ctx, ps.client, func(ctx context.Context, tx queryExecutor) error {
		if _, err := tx.Exec(ctx, deleteUserPasswordFailuresStmt, projectID, userID, forgetBefore); err != nil {
			return wrapError(err)
		}
		_, err := tx.Exec(ctx, addUserPasswordFailureStmt, projectID, id, userID, at)
		return wrapError(err)
	})
}

// ClearUserPasswordFailures implements [service.UserPasswordStatements].
func (ps userPasswordStatements) ClearUserPasswordFailures(ctx context.Context, projectID, userID string, until time.Time) error {
	_, err := ps.client.Exec(ctx, deleteUserPasswordFailuresStmt, projectID, userID, until)
	return wrapError(err)
}
