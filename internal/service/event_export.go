package service

import (
	"context"
	"time"

	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// EventExportAdapter adapts AllStatements to audit retention/shipper interfaces.
type EventExportAdapter struct {
	Pool *DB
}

func (a EventExportAdapter) ListProjectIDs(ctx context.Context) ([]string, error) {
	res, err := a.Pool.Statements().ListProjects(ctx, &database.ListOptions[domain.ProjectField]{
		Pagination: database.Page[domain.ProjectField]{
			Limit: 10000,
			OrderBy: database.OrderBy[domain.ProjectField]{
				Columns: []database.Column[domain.ProjectField]{
					database.Col(domain.ProjectFieldCreatedAt),
					database.Col(domain.ProjectFieldID),
				},
				Direction: database.OrderAsc,
			},
		},
	})
	if err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(res.Items))
	for _, p := range res.Items {
		ids = append(ids, p.ID)
	}
	return ids, nil
}

// ListClaimedProjectIDs returns project IDs that have completed claim
// (resource_scope_index.team_id set), matching ADR 049 export visibility.
func (a EventExportAdapter) ListClaimedProjectIDs(ctx context.Context) ([]string, error) {
	ids, err := a.ListProjectIDs(ctx)
	if err != nil {
		return nil, err
	}
	stmts := a.Pool.Statements()
	claimed := make([]string, 0, len(ids))
	for _, id := range ids {
		ok, err := projectIsClaimed(ctx, stmts, id)
		if err != nil {
			return nil, err
		}
		if ok {
			claimed = append(claimed, id)
		}
	}
	return claimed, nil
}

func (a EventExportAdapter) DeleteEventsOlderThan(ctx context.Context, projectID string, createdBefore time.Time) (int64, error) {
	return a.Pool.Statements().DeleteEventsOlderThan(ctx, projectID, createdBefore)
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

var (
	_ audit.ProjectLister     = EventExportAdapter{}
	_ audit.EventPurger       = EventExportAdapter{}
	_ audit.EventExportSource = EventExportAdapter{}
)
