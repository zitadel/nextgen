package service

import (
	"context"
	"time"

	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const listProjectIDsPageSize = 500

// EventExportAdapter adapts AllStatements to audit retention/shipper interfaces.
type EventExportAdapter struct {
	Pool *DB
}

func (a EventExportAdapter) ListProjectIDs(ctx context.Context) ([]string, error) {
	return collectProjectIDs(ctx, a.Pool.Statements().ListProjects)
}

// collectProjectIDs pages through ListProjects until NextCursor is empty.
func collectProjectIDs(
	ctx context.Context,
	list func(context.Context, *database.ListOptions[domain.ProjectField]) (*database.ListResult[*domain.Project], error),
) ([]string, error) {
	opts := &database.ListOptions[domain.ProjectField]{
		Pagination: database.Page[domain.ProjectField]{
			Limit: listProjectIDsPageSize,
			OrderBy: database.OrderBy[domain.ProjectField]{
				Columns: []database.Column[domain.ProjectField]{
					database.Col(domain.ProjectFieldCreatedAt),
					database.Col(domain.ProjectFieldID),
				},
				Direction: database.OrderAsc,
			},
		},
	}
	res, err := list(ctx, opts)
	if err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(res.Items))
	for project, err := range res.Iterate(func(cursor []byte) (*database.ListResult[*domain.Project], error) {
		opts.Pagination.Cursor = cursor
		return list(ctx, opts)
	}) {
		if err != nil {
			return nil, err
		}
		ids = append(ids, project.ID)
	}
	return ids, nil
}

// ListClaimedProjectIDs returns project IDs that have completed claim
// (resource_scope_index.team_id set), matching ADR 049 export visibility.
func (a EventExportAdapter) ListClaimedProjectIDs(ctx context.Context) ([]string, error) {
	var (
		after string
		all   []string
	)
	for {
		ids, err := a.Pool.Statements().ListClaimedProjectIDs(ctx, after, listProjectIDsPageSize)
		if err != nil {
			return nil, err
		}
		all = append(all, ids...)
		if len(ids) < listProjectIDsPageSize {
			return all, nil
		}
		after = ids[len(ids)-1]
	}
}

func (a EventExportAdapter) DeleteEventsOlderThan(ctx context.Context, createdBefore time.Time) (int64, error) {
	return a.Pool.Statements().DeleteEventsOlderThan(ctx, createdBefore)
}

func (a EventExportAdapter) EnsureSink(ctx context.Context, sink *domain.EventSink) error {
	return a.Pool.Statements().EnsureEventSink(ctx, sink)
}

func (a EventExportAdapter) GetEventSinkCursor(ctx context.Context, sinkID, projectID string) (*domain.EventSinkCursor, error) {
	return a.Pool.Statements().GetEventSinkCursor(ctx, sinkID, projectID)
}

func (a EventExportAdapter) UpsertEventSinkCursor(ctx context.Context, cursor *domain.EventSinkCursor) error {
	return a.Pool.Statements().UpsertEventSinkCursor(ctx, cursor)
}

func (a EventExportAdapter) ListEventsAfterCursor(ctx context.Context, projectID string, afterCreatedAt time.Time, afterID string, limit int) ([]*domain.Event, error) {
	return a.Pool.Statements().ListEventsAfterCursor(ctx, projectID, afterCreatedAt, afterID, uint32(limit))
}

// InsertEvents persists a Path A batch in one transaction.
func (a EventExportAdapter) InsertEvents(ctx context.Context, events []*domain.Event) error {
	if len(events) == 0 {
		return nil
	}
	return a.Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		stmts := tx.Statements()
		for _, ev := range events {
			if err := stmts.InsertEvent(ctx, ev); err != nil {
				return err
			}
		}
		return nil
	})
}

var (
	_ audit.EventPurger        = EventExportAdapter{}
	_ audit.EventExportSource  = EventExportAdapter{}
	_ audit.EventBatchInserter = EventExportAdapter{}
)
