package sqlite

import (
	"context"
	"database/sql"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
)

// The check type is a literal, not a parameter, so the planner can match the
// partial index idx_events_password_checks.
const userPasswordFailuresStmt = `SELECT COUNT(*), MAX(f.created_at)
FROM events f
WHERE f.project_id = ?1
    AND json_extract(f.payload, '$.check_type') = '` + passwordCheckType + `'
    AND json_extract(f.payload, '$.user_id') = ?2
    AND f.event_type = '` + string(domain.EventTypeAuthCheckFailed) + `'
    AND f.created_at > MAX(?3, COALESCE((
        SELECT MAX(s.created_at)
        FROM events s
        WHERE s.project_id = ?1
            AND json_extract(s.payload, '$.check_type') = '` + passwordCheckType + `'
            AND json_extract(s.payload, '$.user_id') = ?2
            AND s.event_type = '` + string(domain.EventTypeAuthCheckSucceeded) + `'
            AND s.created_at > ?3
    ), ?3))`

const passwordCheckType = "Password"

// GetUserPasswordFailures implements [service.EventStatements].
func (e eventStatements) GetUserPasswordFailures(ctx context.Context, projectID, userID string, since time.Time) (domain.UserPasswordFailures, error) {
	var (
		count    int64
		lastNano sql.NullInt64
	)
	if err := e.client.QueryRow(ctx, userPasswordFailuresStmt, projectID, userID, since.UTC().UnixNano()).Scan(&count, &lastNano); err != nil {
		return domain.UserPasswordFailures{}, wrapError(err)
	}
	failures := domain.UserPasswordFailures{Count: int(count)}
	if lastNano.Valid {
		failures.LastFailedAt = timeFromUnixNano(lastNano.Int64)
	}
	return failures, nil
}
