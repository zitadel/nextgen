package postgres

import (
	"context"
	"database/sql"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
)

// The check type and event types are literals, not parameters, so the
// planner can match the partial index idx_events_password_checks.
const userPasswordFailuresStmt = `SELECT COUNT(*), MAX(f.created_at)
FROM zitadel_nextgen.events f
WHERE f.project_id = $1
    AND f.payload->>'check_type' = '` + passwordCheckType + `'
    AND f.payload->>'user_id' = $2
    AND f.event_type = '` + string(domain.EventTypeAuthCheckFailed) + `'
    AND f.created_at > GREATEST($3, COALESCE((
        SELECT MAX(s.created_at)
        FROM zitadel_nextgen.events s
        WHERE s.project_id = $1
            AND s.payload->>'check_type' = '` + passwordCheckType + `'
            AND s.payload->>'user_id' = $2
            AND s.event_type = '` + string(domain.EventTypeAuthCheckSucceeded) + `'
            AND s.created_at > $3
    ), $3))`

const passwordCheckType = "Password"

// GetUserPasswordFailures implements [service.EventStatements].
func (e eventStatements) GetUserPasswordFailures(ctx context.Context, projectID, userID string, since time.Time) (domain.UserPasswordFailures, error) {
	var (
		count int64
		last  sql.NullTime
	)
	if err := e.client.QueryRow(ctx, userPasswordFailuresStmt, projectID, userID, since).Scan(&count, &last); err != nil {
		return domain.UserPasswordFailures{}, wrapError(err)
	}
	return domain.UserPasswordFailures{Count: int(count), LastFailedAt: last.Time.UTC()}, nil
}
