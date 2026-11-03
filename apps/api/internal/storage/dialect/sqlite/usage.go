package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/events"
)

const (
	getUsageCursorStmt = `
SELECT project_id, counted_before, last_event_id
FROM usage_cursors
WHERE project_id = ?`

	// advanceUsageCursorStmt is a compare-and-set. SQLite has one writer, so
	// a second run that read the same cursor starts after the first commits,
	// and matches no row.
	advanceUsageCursorStmt = `
UPDATE usage_cursors
SET counted_before = ?, last_event_id = ?
WHERE project_id = ? AND counted_before = ? AND last_event_id = ?`

	insertUsageCursorStmt = `
INSERT INTO usage_cursors (project_id, counted_before, last_event_id)
VALUES (?, ?, ?)
ON CONFLICT (project_id) DO NOTHING`

	// The user ids bind as one JSON array, read back by json_each.
	seenUsageUsersStmt = `
SELECT user_id FROM usage_first_seen
WHERE project_id = ? AND meter = ? AND month = ? AND user_id IN (SELECT value FROM json_each(?))`

	insertUsageFirstSeenStmt = `
INSERT INTO usage_first_seen (project_id, meter, month, user_id)
SELECT ?, ?, ?, value FROM json_each(?)`

	addUsageHourStmt = `
INSERT INTO usage_hours (project_id, meter, hour, value)
VALUES (?, ?, ?, ?)
ON CONFLICT (project_id, meter, hour) DO UPDATE SET value = usage_hours.value + excluded.value`

	readUsageHoursStmt = `
SELECT meter, hour, value FROM usage_hours
WHERE project_id = ? AND meter IN (SELECT value FROM json_each(?)) AND hour >= ? AND hour < ?
ORDER BY meter, hour`

	deleteCountedEventsOlderThanStmt = `
DELETE FROM events
WHERE created_at < ?
    AND NOT EXISTS (
        SELECT 1 FROM usage_cursors c
        WHERE c.project_id = events.project_id AND c.counted_before <= events.created_at
    )`
)

type usageStatements struct{ statement }

func newUsageStatements(client queryExecutor) usageStatements {
	return usageStatements{statement: statement{client: client}}
}

// ReadUsageEvents implements [service.UsageStatements]. The bound is the
// clock, read before the list: insertEventStmt never stamps an event before
// its project's counted_before, so one that commits after this read is
// stamped at or after any bound a cursor moved to.
func (u usageStatements) ReadUsageEvents(ctx context.Context, projectID string, after *domain.UsageCursor, types []domain.EventType, limit uint32) ([]*domain.Event, time.Time, error) {
	bound := timeFromUnixNano(nowUnixNano())
	var compiler statementCompiler
	if err := compileRead(&compiler, eventQuery, events.UsageReadOptions(projectID, after, types, bound, limit), events.Schema); err != nil {
		return nil, time.Time{}, err
	}
	rows, err := u.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, time.Time{}, wrapError(err)
	}
	defer rows.Close()
	var items []*domain.Event
	for rows.Next() {
		item, err := scanEvent(rows)
		if err != nil {
			return nil, time.Time{}, wrapError(err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, time.Time{}, wrapError(err)
	}
	return items, bound, nil
}

// GetUsageCursor implements [service.UsageStatements].
func (u usageStatements) GetUsageCursor(ctx context.Context, projectID string) (*domain.UsageCursor, error) {
	var (
		c             domain.UsageCursor
		countedBefore int64
	)
	err := u.client.QueryRow(ctx, getUsageCursorStmt, projectID).Scan(&c.ProjectID, &countedBefore, &c.LastEventID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, wrapError(err)
	}
	c.CountedBefore = timeFromUnixNano(countedBefore)
	return &c, nil
}

// AdvanceUsageCursor implements [service.UsageStatements].
func (u usageStatements) AdvanceUsageCursor(ctx context.Context, prev *domain.UsageCursor, next domain.UsageCursor) (bool, error) {
	var (
		res sql.Result
		err error
	)
	if prev == nil {
		res, err = u.client.Exec(ctx, insertUsageCursorStmt, next.ProjectID, next.CountedBefore.UTC().UnixNano(), next.LastEventID)
	} else {
		res, err = u.client.Exec(ctx, advanceUsageCursorStmt,
			next.CountedBefore.UTC().UnixNano(), next.LastEventID,
			next.ProjectID, prev.CountedBefore.UTC().UnixNano(), prev.LastEventID,
		)
	}
	if err != nil {
		return false, wrapError(err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return false, wrapError(err)
	}
	return n == 1, nil
}

// SeenUsageUsers implements [service.UsageStatements].
func (u usageStatements) SeenUsageUsers(ctx context.Context, projectID, meter string, month time.Time, userIDs []string) ([]string, error) {
	ids, err := json.Marshal(userIDs)
	if err != nil {
		return nil, err
	}
	rows, err := u.client.Query(ctx, seenUsageUsersStmt, projectID, meter, month.UTC().UnixNano(), string(ids))
	if err != nil {
		return nil, wrapError(err)
	}
	defer rows.Close()
	var seen []string
	for rows.Next() {
		var userID string
		if err := rows.Scan(&userID); err != nil {
			return nil, wrapError(err)
		}
		seen = append(seen, userID)
	}
	if err := rows.Err(); err != nil {
		return nil, wrapError(err)
	}
	return seen, nil
}

// InsertUsageFirstSeen implements [service.UsageStatements].
func (u usageStatements) InsertUsageFirstSeen(ctx context.Context, projectID, meter string, month time.Time, userIDs []string) error {
	if len(userIDs) == 0 {
		return nil
	}
	ids, err := json.Marshal(userIDs)
	if err != nil {
		return err
	}
	_, err = u.client.Exec(ctx, insertUsageFirstSeenStmt, projectID, meter, month.UTC().UnixNano(), string(ids))
	return wrapError(err)
}

// AddUsageHours implements [service.UsageStatements].
func (u usageStatements) AddUsageHours(ctx context.Context, projectID string, hours []domain.UsageHour) error {
	if len(hours) == 0 {
		return nil
	}
	return withTransaction(ctx, u.client, func(ctx context.Context, tx queryExecutor) error {
		for _, hour := range hours {
			if _, err := tx.Exec(ctx, addUsageHourStmt, projectID, hour.Meter, hour.Hour.UTC().UnixNano(), hour.Value); err != nil {
				return wrapError(err)
			}
		}
		return nil
	})
}

// ReadUsageHours implements [service.UsageStatements].
func (u usageStatements) ReadUsageHours(ctx context.Context, projectID string, meters []string, from, to time.Time) ([]domain.UsageHour, error) {
	names, err := json.Marshal(meters)
	if err != nil {
		return nil, err
	}
	rows, err := u.client.Query(ctx, readUsageHoursStmt, projectID, string(names), from.UTC().UnixNano(), to.UTC().UnixNano())
	if err != nil {
		return nil, wrapError(err)
	}
	defer rows.Close()
	var hours []domain.UsageHour
	for rows.Next() {
		var (
			hour  domain.UsageHour
			start int64
		)
		if err := rows.Scan(&hour.Meter, &start, &hour.Value); err != nil {
			return nil, wrapError(err)
		}
		hour.Hour = timeFromUnixNano(start)
		hours = append(hours, hour)
	}
	if err := rows.Err(); err != nil {
		return nil, wrapError(err)
	}
	return hours, nil
}

// DeleteCountedEventsOlderThan implements [service.UsageStatements].
func (u usageStatements) DeleteCountedEventsOlderThan(ctx context.Context, createdBefore time.Time) (int64, error) {
	res, err := u.client.Exec(ctx, deleteCountedEventsOlderThanStmt, createdBefore.UTC().UnixNano())
	if err != nil {
		return 0, wrapError(err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return 0, wrapError(err)
	}
	return n, nil
}

var _ service.UsageStatements = (*usageStatements)(nil)
