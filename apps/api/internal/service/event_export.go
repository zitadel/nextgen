package service

import (
	"context"
	"errors"
	"slices"
	"time"

	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const listProjectIDsPageSize = 500

// EventExportAdapter adapts AllStatements to audit retention/shipper interfaces.
type EventExportAdapter struct {
	Pool *DB
	// PlatformProjectID is the deployment's platform project, which ships
	// without a claim (ADR 049 §4); empty, only claimed projects ship.
	PlatformProjectID string
}

func (a EventExportAdapter) ListProjectIDs(ctx context.Context) (_ []string, err error) {
	ctx, end := startSpan(ctx, "EventExportAdapter.ListProjectIDs")
	defer end(&err)

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

// ListVisibleProjectIDs returns the projects whose events ship: those that
// have completed claim (active owning-team grant, ADR 054 §2) and the platform
// project, the same projects GET /events reads (ADR 049 §4).
func (a EventExportAdapter) ListVisibleProjectIDs(ctx context.Context) (_ []string, err error) {
	ctx, end := startSpan(ctx, "EventExportAdapter.ListVisibleProjectIDs")
	defer end(&err)

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
			break
		}
		after = ids[len(ids)-1]
	}
	if a.PlatformProjectID == "" || slices.Contains(all, a.PlatformProjectID) {
		return all, nil
	}
	// A platform project that is gone ships nothing: its sink cursor could not
	// be stored, so every run would deliver its first page again.
	if _, err := a.Pool.Statements().GetProjectByID(ctx, a.PlatformProjectID); err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return all, nil
		}
		return nil, err
	}
	return append(all, a.PlatformProjectID), nil
}

func (a EventExportAdapter) DeleteEventsOlderThan(ctx context.Context, createdBefore time.Time) (_ int64, err error) {
	ctx, end := startSpan(ctx, "EventExportAdapter.DeleteEventsOlderThan")
	defer end(&err)

	return a.Pool.Statements().DeleteEventsOlderThan(ctx, createdBefore)
}

func (a EventExportAdapter) EnsureSink(ctx context.Context, sink *domain.EventSink) (err error) {
	ctx, end := startSpan(ctx, "EventExportAdapter.EnsureSink")
	defer end(&err)

	return a.Pool.Statements().EnsureEventSink(ctx, sink)
}

func (a EventExportAdapter) GetEventSinkCursor(ctx context.Context, sinkID, projectID string) (_ *domain.EventSinkCursor, err error) {
	ctx, end := startSpan(ctx, "EventExportAdapter.GetEventSinkCursor")
	defer end(&err)

	return a.Pool.Statements().GetEventSinkCursor(ctx, sinkID, projectID)
}

func (a EventExportAdapter) UpsertEventSinkCursor(ctx context.Context, cursor *domain.EventSinkCursor) (err error) {
	ctx, end := startSpan(ctx, "EventExportAdapter.UpsertEventSinkCursor")
	defer end(&err)

	return a.Pool.Statements().UpsertEventSinkCursor(ctx, cursor)
}

func (a EventExportAdapter) ListEventsAfterCursor(ctx context.Context, projectID string, afterCreatedAt time.Time, afterID string, limit int) (_ []*domain.Event, err error) {
	ctx, end := startSpan(ctx, "EventExportAdapter.ListEventsAfterCursor")
	defer end(&err)

	return a.Pool.Statements().ListEventsAfterCursor(ctx, projectID, afterCreatedAt, afterID, uint32(limit))
}

// InsertEvents persists a Path A batch in one transaction.
func (a EventExportAdapter) InsertEvents(ctx context.Context, events []*domain.Event) (err error) {
	ctx, end := startSpan(ctx, "EventExportAdapter.InsertEvents")
	defer end(&err)

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
