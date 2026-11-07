package postgres

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/events"
)

const (
	getUsageCursorStmt = `
SELECT project_id, counted_before, last_event_id
FROM zitadel_nextgen.usage_cursors
WHERE project_id = $1`

	// advanceUsageCursorStmt is a compare-and-set: a second run that read the
	// same cursor waits on the first one's row lock, then matches no row.
	advanceUsageCursorStmt = `
UPDATE zitadel_nextgen.usage_cursors
SET counted_before = $2, last_event_id = $3
WHERE project_id = $1 AND counted_before = $4 AND last_event_id = $5`

	insertUsageCursorStmt = `
INSERT INTO zitadel_nextgen.usage_cursors (project_id, counted_before, last_event_id)
VALUES ($1, $2, $3)
ON CONFLICT (project_id) DO NOTHING`

	seenUsageUsersStmt = `
SELECT user_id FROM zitadel_nextgen.usage_first_seen
WHERE project_id = $1 AND meter = $2 AND month = $3 AND user_id = ANY($4)`

	insertUsageFirstSeenStmt = `
INSERT INTO zitadel_nextgen.usage_first_seen (project_id, meter, month, user_id)
SELECT $1, $2, $3, unnest($4::text[])`

	addUsageHoursStmt = `
INSERT INTO zitadel_nextgen.usage_hours AS u (project_id, meter, hour, value)
SELECT $1, h.meter, h.hour, h.value
FROM unnest($2::text[], $3::timestamptz[], $4::bigint[]) AS h (meter, hour, value)
ON CONFLICT (project_id, meter, hour) DO UPDATE SET value = u.value + EXCLUDED.value`

	readUsageHoursStmt = `
SELECT meter, hour, value FROM zitadel_nextgen.usage_hours
WHERE project_id = $1 AND meter = ANY($2) AND hour >= $3 AND hour < $4
ORDER BY meter, hour`

	deleteCountedEventsOlderThanStmt = `
DELETE FROM zitadel_nextgen.events e
WHERE e.created_at < $1
    AND NOT EXISTS (
        SELECT 1 FROM zitadel_nextgen.usage_cursors c
        WHERE c.project_id = e.project_id AND c.counted_before <= e.created_at
    )`
)

type usageStatements struct {
	statement
	events eventStatements
}

func newUsageStatements(client queryExecutor) usageStatements {
	return usageStatements{statement: statement{client: client}, events: newEventStatements(client)}
}

// ReadUsageEvents implements [service.UsageStatements]. The bound is the
// events' settled bound (EventsSettledBefore), read before the list so the
// list's snapshot holds every commit it counted as done.
func (u usageStatements) ReadUsageEvents(ctx context.Context, projectID string, after *domain.UsageCursor, types []domain.EventType, limit uint32) ([]*domain.Event, time.Time, error) {
	bound, err := u.events.EventsSettledBefore(ctx, projectID)
	if err != nil {
		return nil, time.Time{}, err
	}
	var compiler statementCompiler
	if err := compileRead(&compiler, eventQuery, events.UsageReadOptions(projectID, after, types, bound, limit), events.Schema); err != nil {
		return nil, time.Time{}, err
	}
	rows, err := u.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, time.Time{}, wrapError(err)
	}
	items, err := pgx.CollectRows(rows, u.events.scanEvent)
	if err != nil {
		return nil, time.Time{}, wrapError(err)
	}
	return items, bound, nil
}

// GetUsageCursor implements [service.UsageStatements].
func (u usageStatements) GetUsageCursor(ctx context.Context, projectID string) (*domain.UsageCursor, error) {
	var c domain.UsageCursor
	err := u.client.QueryRow(ctx, getUsageCursorStmt, projectID).Scan(&c.ProjectID, &c.CountedBefore, &c.LastEventID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, wrapError(err)
	}
	c.CountedBefore = c.CountedBefore.UTC()
	return &c, nil
}

// AdvanceUsageCursor implements [service.UsageStatements].
func (u usageStatements) AdvanceUsageCursor(ctx context.Context, prev *domain.UsageCursor, next domain.UsageCursor) (bool, error) {
	if prev == nil {
		tag, err := u.client.Exec(ctx, insertUsageCursorStmt, next.ProjectID, next.CountedBefore.UTC(), next.LastEventID)
		if err != nil {
			return false, wrapError(err)
		}
		return tag.RowsAffected() == 1, nil
	}
	tag, err := u.client.Exec(ctx, advanceUsageCursorStmt,
		next.ProjectID, next.CountedBefore.UTC(), next.LastEventID,
		prev.CountedBefore.UTC(), prev.LastEventID,
	)
	if err != nil {
		return false, wrapError(err)
	}
	return tag.RowsAffected() == 1, nil
}

// SeenUsageUsers implements [service.UsageStatements].
func (u usageStatements) SeenUsageUsers(ctx context.Context, projectID, meter string, month time.Time, userIDs []string) ([]string, error) {
	rows, err := u.client.Query(ctx, seenUsageUsersStmt, projectID, meter, month.UTC(), userIDs)
	if err != nil {
		return nil, wrapError(err)
	}
	seen, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return nil, wrapError(err)
	}
	return seen, nil
}

// InsertUsageFirstSeen implements [service.UsageStatements].
func (u usageStatements) InsertUsageFirstSeen(ctx context.Context, projectID, meter string, month time.Time, userIDs []string) error {
	if len(userIDs) == 0 {
		return nil
	}
	_, err := u.client.Exec(ctx, insertUsageFirstSeenStmt, projectID, meter, month.UTC(), userIDs)
	return wrapError(err)
}

// AddUsageHours implements [service.UsageStatements].
func (u usageStatements) AddUsageHours(ctx context.Context, projectID string, hours []domain.UsageHour) error {
	if len(hours) == 0 {
		return nil
	}
	meters := make([]string, len(hours))
	starts := make([]time.Time, len(hours))
	values := make([]int64, len(hours))
	for i, hour := range hours {
		meters[i], starts[i], values[i] = hour.Meter, hour.Hour.UTC(), hour.Value
	}
	_, err := u.client.Exec(ctx, addUsageHoursStmt, projectID, meters, starts, values)
	return wrapError(err)
}

// ReadUsageHours implements [service.UsageStatements].
func (u usageStatements) ReadUsageHours(ctx context.Context, projectID string, meters []string, from, to time.Time) ([]domain.UsageHour, error) {
	rows, err := u.client.Query(ctx, readUsageHoursStmt, projectID, meters, from.UTC(), to.UTC())
	if err != nil {
		return nil, wrapError(err)
	}
	hours, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.UsageHour, error) {
		var hour domain.UsageHour
		err := row.Scan(&hour.Meter, &hour.Hour, &hour.Value)
		hour.Hour = hour.Hour.UTC()
		return hour, err
	})
	if err != nil {
		return nil, wrapError(err)
	}
	return hours, nil
}

// DeleteCountedEventsOlderThan implements [service.UsageStatements].
func (u usageStatements) DeleteCountedEventsOlderThan(ctx context.Context, createdBefore time.Time) (int64, error) {
	tag, err := u.client.Exec(ctx, deleteCountedEventsOlderThanStmt, createdBefore.UTC())
	if err != nil {
		return 0, wrapError(err)
	}
	return tag.RowsAffected(), nil
}

var _ service.UsageStatements = (*usageStatements)(nil)
