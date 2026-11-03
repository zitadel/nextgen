package spanner

import (
	"context"
	"errors"
	"time"

	"cloud.google.com/go/spanner"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/events"
)

const (
	usageFirstSeenTable = "usage_first_seen"

	getUsageCursorStmt = `
SELECT project_id, counted_before, last_event_id
FROM usage_cursors
WHERE project_id = @p1`

	// advanceUsageCursorStmt is a compare-and-set: of two runs that read the
	// same cursor, wound-wait aborts one, and its replay matches no row.
	advanceUsageCursorStmt = `
UPDATE usage_cursors
SET counted_before = @p2, last_event_id = @p3
WHERE project_id = @p1 AND counted_before = @p4 AND last_event_id = @p5`

	// insertUsageCursorStmt ignores a row that is there already: a plain
	// INSERT would end the read-write transaction with AlreadyExists.
	insertUsageCursorStmt = `
INSERT OR IGNORE INTO usage_cursors (project_id, counted_before, last_event_id)
VALUES (@p1, @p2, @p3)`

	seenUsageUsersStmt = `
SELECT user_id FROM usage_first_seen
WHERE project_id = @p1 AND meter = @p2 AND month = @p3 AND user_id IN UNNEST(@p4)`

	addUsageHourStmt = `
INSERT INTO usage_hours (project_id, meter, hour, value)
VALUES (@p1, @p2, @p3, @p4)
ON CONFLICT (project_id, meter, hour) DO UPDATE SET value = usage_hours.value + EXCLUDED.value`

	readUsageHoursStmt = `
SELECT meter, hour, value FROM usage_hours
WHERE project_id = @p1 AND meter IN UNNEST(@p2) AND hour >= @p3 AND hour < @p4
ORDER BY meter, hour`

	deleteCountedEventsOlderThanStmt = `
DELETE FROM events
WHERE created_at < @p1
    AND NOT EXISTS (
        SELECT 1 FROM usage_cursors c
        WHERE c.project_id = events.project_id AND c.counted_before <= events.created_at
    )`
)

var usageFirstSeenColumns = []string{"project_id", "meter", "month", "user_id"}

type usageStatements struct {
	statement
	events eventStatements
}

func newUsageStatements(db queryExecutor) usageStatements {
	return usageStatements{statement: statement{db: db}, events: newEventStatements(db)}
}

// ReadUsageEvents implements [service.UsageStatements]. created_at is the
// commit timestamp (eventStatements.InsertEvent), so one strong read holds
// every event that committed at or before its timestamp, and any event that
// commits later is stamped after it: the bound is that timestamp's next
// instant.
func (u usageStatements) ReadUsageEvents(ctx context.Context, projectID string, after *domain.UsageCursor, types []domain.EventType, limit uint32) ([]*domain.Event, time.Time, error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, eventQuery, events.UsageReadOptions(projectID, after, types, time.Time{}, limit), events.Schema); err != nil {
		return nil, time.Time{}, err
	}
	var items []*domain.Event
	readAt, err := u.db.QueryStrong(ctx, compiler.statement(), func(iter *spanner.RowIterator) error {
		var err error
		items, err = collectRows(iter, u.events.scanEvent)
		return err
	})
	if err != nil {
		return nil, time.Time{}, err
	}
	return items, readAt.UTC().Add(time.Nanosecond), nil
}

// GetUsageCursor implements [service.UsageStatements].
func (u usageStatements) GetUsageCursor(ctx context.Context, projectID string) (*domain.UsageCursor, error) {
	var cursor *domain.UsageCursor
	err := u.db.Query(ctx, buildStatement(getUsageCursorStmt, projectID).statement(), func(iter *spanner.RowIterator) error {
		var err error
		cursor, err = collectOneRow(iter, func(row *spanner.Row) (*domain.UsageCursor, error) {
			var c domain.UsageCursor
			if err := row.Columns(&c.ProjectID, &c.CountedBefore, &c.LastEventID); err != nil {
				return nil, err
			}
			c.CountedBefore = c.CountedBefore.UTC()
			return &c, nil
		})
		return err
	})
	if err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return nil, nil
		}
		return nil, err
	}
	return cursor, nil
}

// AdvanceUsageCursor implements [service.UsageStatements].
func (u usageStatements) AdvanceUsageCursor(ctx context.Context, prev *domain.UsageCursor, next domain.UsageCursor) (bool, error) {
	stmt := buildStatement(insertUsageCursorStmt, next.ProjectID, next.CountedBefore.UTC(), next.LastEventID)
	if prev != nil {
		stmt = buildStatement(advanceUsageCursorStmt,
			next.ProjectID, next.CountedBefore.UTC(), next.LastEventID,
			prev.CountedBefore.UTC(), prev.LastEventID,
		)
	}
	n, err := u.db.Update(ctx, stmt.statement())
	if err != nil {
		return false, err
	}
	return n == 1, nil
}

// SeenUsageUsers implements [service.UsageStatements].
func (u usageStatements) SeenUsageUsers(ctx context.Context, projectID, meter string, month time.Time, userIDs []string) ([]string, error) {
	var seen []string
	err := u.db.Query(ctx, buildStatement(seenUsageUsersStmt, projectID, meter, month.UTC(), userIDs).statement(), func(iter *spanner.RowIterator) error {
		var err error
		seen, err = collectRows(iter, func(row *spanner.Row) (string, error) {
			var userID string
			err := row.Columns(&userID)
			return userID, err
		})
		return err
	})
	if err != nil {
		return nil, err
	}
	return seen, nil
}

// InsertUsageFirstSeen implements [service.UsageStatements]. Mutations queue
// in the caller's transaction and apply at its commit.
func (u usageStatements) InsertUsageFirstSeen(ctx context.Context, projectID, meter string, month time.Time, userIDs []string) error {
	if len(userIDs) == 0 {
		return nil
	}
	mutations := make([]*spanner.Mutation, 0, len(userIDs))
	for _, userID := range userIDs {
		mutations = append(mutations, spanner.Insert(usageFirstSeenTable, usageFirstSeenColumns,
			[]any{projectID, meter, month.UTC(), userID}))
	}
	_, err := u.db.BufferWrite(ctx, mutations)
	return err
}

// AddUsageHours implements [service.UsageStatements].
func (u usageStatements) AddUsageHours(ctx context.Context, projectID string, hours []domain.UsageHour) error {
	if len(hours) == 0 {
		return nil
	}
	return withTransaction(ctx, u.db, func(ctx context.Context, tx queryExecutor) error {
		for _, hour := range hours {
			if _, err := tx.Update(ctx, buildStatement(addUsageHourStmt, projectID, hour.Meter, hour.Hour.UTC(), hour.Value).statement()); err != nil {
				return err
			}
		}
		return nil
	})
}

// ReadUsageHours implements [service.UsageStatements].
func (u usageStatements) ReadUsageHours(ctx context.Context, projectID string, meters []string, from, to time.Time) ([]domain.UsageHour, error) {
	var hours []domain.UsageHour
	err := u.db.Query(ctx, buildStatement(readUsageHoursStmt, projectID, meters, from.UTC(), to.UTC()).statement(), func(iter *spanner.RowIterator) error {
		var err error
		hours, err = collectRows(iter, func(row *spanner.Row) (domain.UsageHour, error) {
			var hour domain.UsageHour
			err := row.Columns(&hour.Meter, &hour.Hour, &hour.Value)
			hour.Hour = hour.Hour.UTC()
			return hour, err
		})
		return err
	})
	if err != nil {
		return nil, err
	}
	return hours, nil
}

// DeleteCountedEventsOlderThan implements [service.UsageStatements].
func (u usageStatements) DeleteCountedEventsOlderThan(ctx context.Context, createdBefore time.Time) (int64, error) {
	return u.db.Update(ctx, buildStatement(deleteCountedEventsOlderThanStmt, createdBefore.UTC()).statement())
}

var _ service.UsageStatements = (*usageStatements)(nil)
