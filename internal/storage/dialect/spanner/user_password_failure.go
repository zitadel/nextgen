package spanner

import (
	"context"
	"time"

	"cloud.google.com/go/spanner"

	"github.com/zitadel/nextgen/internal/domain"
)

// password_check_user_id is the generated column behind
// idx_events_password_checks: the payload's user_id on password check events,
// NULL on every other event. The equality on it excludes the NULLs the index
// skips; the emulator cannot tell, and its hint is ignored by Cloud Spanner.
//
// The last success is a one-row derived table rather than a scalar subquery in
// the WHERE clause: the emulator evaluates such a subquery again for every row
// it scans, which took seconds on a few thousand events and starved every
// transaction behind it.
const userPasswordFailuresStmt = `SELECT COUNT(f.created_at), MAX(f.created_at)
FROM (
    SELECT GREATEST(@p3, COALESCE(MAX(s.created_at), @p3)) AS since
    FROM events@{FORCE_INDEX=idx_events_password_checks, spanner_emulator.disable_query_null_filtered_index_check=true} s
    WHERE s.project_id = @p1
        AND s.password_check_user_id = @p2
        AND s.event_type = '` + string(domain.EventTypeAuthCheckSucceeded) + `'
        AND s.created_at > @p3
) r
LEFT JOIN events@{FORCE_INDEX=idx_events_password_checks, spanner_emulator.disable_query_null_filtered_index_check=true} f
    ON f.project_id = @p1
    AND f.password_check_user_id = @p2
    AND f.event_type = '` + string(domain.EventTypeAuthCheckFailed) + `'
    AND f.created_at > r.since`

// GetUserPasswordFailures implements [service.EventStatements].
func (e eventStatements) GetUserPasswordFailures(ctx context.Context, projectID, userID string, since time.Time) (domain.UserPasswordFailures, error) {
	var failures domain.UserPasswordFailures
	stmt := buildStatement(userPasswordFailuresStmt, projectID, userID, since).statement()
	err := e.db.Query(ctx, stmt, func(iter *spanner.RowIterator) error {
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
