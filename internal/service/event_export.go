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

func (a EventExportAdapter) DeleteEventsOlderThan(ctx context.Context, projectID string, createdBefore time.Time) (int64, error) {
	return a.Pool.Statements().DeleteEventsOlderThan(ctx, projectID, createdBefore)
}

func (a EventExportAdapter) ListUndeliveredEvents(ctx context.Context, sinkID string, limit int) ([]*domain.Event, error) {
	return a.Pool.Statements().ListUndeliveredEvents(ctx, sinkID, uint32(limit))
}

func (a EventExportAdapter) RecordDelivery(ctx context.Context, projectID, eventID, sinkID string) error {
	return a.Pool.Statements().RecordEventDelivery(ctx, projectID, eventID, sinkID)
}

func (a EventExportAdapter) EnsureSink(ctx context.Context, sink *domain.EventSink) error {
	return a.Pool.Statements().EnsureEventSink(ctx, sink)
}

var (
	_ audit.ProjectLister          = EventExportAdapter{}
	_ audit.EventPurger            = EventExportAdapter{}
	_ audit.UndeliveredEventSource = EventExportAdapter{}
)
