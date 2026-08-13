package spanner

import (
	"context"
	"time"

	"cloud.google.com/go/spanner"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
	"github.com/zitadel/nextgen/internal/storage/events"
)

const (
	eventsTable = "events"

	eventQuery = `SELECT
    project_id, id, event_type, category,
    occurred_at, created_at,
    team_id, actor_id, actor_type,
    entity_type, entity_id,
    client_id, token_id, delegation_type, delegation_id, grantor, fingerprint,
    request_id, session_id, flow_id,
    payload, metadata
FROM events`

	deleteEventsOlderThanStmt = `
DELETE FROM events
WHERE created_at < @p1`

	ensureEventSinkStmt = `
INSERT INTO event_sinks (id, type, scope, project_id, url, enabled)
VALUES (@p1, @p2, @p3, @p4, @p5, @p6)
ON CONFLICT (id) DO UPDATE SET
    type = EXCLUDED.type,
    scope = EXCLUDED.scope,
    project_id = EXCLUDED.project_id,
    url = EXCLUDED.url,
    enabled = EXCLUDED.enabled`

	getEventSinkCursorStmt = `
SELECT sink_id, project_id, last_created_at, last_event_id
FROM event_sink_cursors
WHERE sink_id = @p1 AND project_id = @p2`

	upsertEventSinkCursorStmt = `
INSERT INTO event_sink_cursors (sink_id, project_id, last_created_at, last_event_id)
VALUES (@p1, @p2, @p3, @p4)
ON CONFLICT (sink_id, project_id) DO UPDATE SET
    last_created_at = EXCLUDED.last_created_at,
    last_event_id = EXCLUDED.last_event_id`
)

var eventColumns = []string{
	"project_id", "id", "event_type", "category",
	"occurred_at", "created_at",
	"team_id", "actor_id", "actor_type",
	"entity_type", "entity_id",
	"client_id", "token_id", "delegation_type", "delegation_id", "grantor", "fingerprint",
	"request_id", "session_id", "flow_id",
	"payload", "metadata",
}

type eventStatements struct{ statement }

func newEventStatements(db queryExecutor) eventStatements {
	return eventStatements{statement: statement{db: db}}
}

// InsertEvent implements [service.EventStatements].
//
// Uses BufferWrite so Path B inserts inside an outer read-write transaction
// queue locally and apply at commit — no per-event DML RPC. The Spanner
// emulator serializes one transaction at a time; intermediate THEN RETURN
// inserts lengthened compound TXs enough to blow the abort-retry budget under
// parallel integration tests.
func (e eventStatements) InsertEvent(ctx context.Context, event *domain.Event) error {
	if event.ProjectID == "" {
		return domain.ErrEventInvalid("missing project_id", nil)
	}
	if event.EventType == "" || event.Category == "" {
		return domain.ErrEventInvalid("missing event_type or category", nil)
	}
	if err := ensureManagedID(&event.ID, domain.PrefixEvent); err != nil {
		return err
	}
	payloadRaw := events.NormalizeJSON(event.Payload)
	metadataRaw := events.NormalizeJSON(event.Metadata)
	payload, err := encodeNullJSON(payloadRaw)
	if err != nil {
		return err
	}
	metadata, err := encodeNullJSON(metadataRaw)
	if err != nil {
		return err
	}
	wait := event.OccurredAtWait
	if wait < 0 {
		wait = 0
	}
	createdAt := time.Now().UTC()
	occurredAt := createdAt.Add(-wait)

	m := spanner.InsertMap(eventsTable, map[string]any{
		"project_id":      event.ProjectID,
		"id":              event.ID,
		"event_type":      string(event.EventType),
		"category":        string(event.Category),
		"occurred_at":     occurredAt,
		"created_at":      createdAt,
		"team_id":         nullString(event.TeamID),
		"actor_id":        nullString(event.ActorID),
		"actor_type":      nullActorType(event.ActorType),
		"entity_type":     nullString(event.EntityType),
		"entity_id":       nullString(event.EntityID),
		"client_id":       event.ClientID,
		"token_id":        event.TokenID,
		"delegation_type": event.DelegationType,
		"delegation_id":   event.DelegationID,
		"grantor":         event.Grantor,
		"fingerprint":     event.Fingerprint,
		"request_id":      nullString(event.RequestID),
		"session_id":      nullString(event.SessionID),
		"flow_id":         nullString(event.FlowID),
		"payload":         payload,
		"metadata":        metadata,
	})
	if err := e.db.BufferWrite(ctx, []*spanner.Mutation{m}); err != nil {
		return err
	}
	event.OccurredAt = occurredAt
	event.CreatedAt = createdAt
	event.Payload = payloadRaw
	event.Metadata = metadataRaw
	return nil
}

// GetEventByID implements [service.EventStatements].
func (e eventStatements) GetEventByID(ctx context.Context, projectID, id string) (*domain.Event, error) {
	row, err := e.db.ReadRow(ctx, eventsTable, spanner.Key{projectID, id}, eventColumns)
	if err != nil {
		return nil, err
	}
	return e.scanEvent(row)
}

// ListEvents implements [service.EventStatements].
func (e eventStatements) ListEvents(ctx context.Context, filter *database.ListOptions[domain.EventField]) (*database.ListResult[*domain.Event], error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, eventQuery, filter, events.Schema); err != nil {
		return nil, err
	}
	var items []*domain.Event
	err := e.db.Query(ctx, compiler.statement(), func(iter *spanner.RowIterator) error {
		var err error
		items, err = collectRows(iter, e.scanEvent)
		return err
	})
	if err != nil {
		return nil, err
	}
	var nextCursor []byte
	if filter.Pagination.Limit > 0 && len(items) == int(filter.Pagination.Limit) {
		cursor := &pagination.Cursor[domain.EventField]{
			Columns: filter.Pagination.OrderBy.Columns,
			Values:  events.Schema.ValuesFrom(items[len(items)-1], filter.Pagination.OrderBy.Columns),
		}
		nextCursor = cursor.Marshal()
	}
	return &database.ListResult[*domain.Event]{
		Items:      items,
		NextCursor: nextCursor,
	}, nil
}

// DeleteEventsOlderThan implements [service.EventStatements].
func (e eventStatements) DeleteEventsOlderThan(ctx context.Context, createdBefore time.Time) (int64, error) {
	n, err := e.db.Update(ctx, buildStatement(deleteEventsOlderThanStmt, createdBefore.UTC()).statement())
	if err != nil {
		return 0, err
	}
	return n, nil
}

// EnsureEventSink implements [service.EventStatements].
func (e eventStatements) EnsureEventSink(ctx context.Context, sink *domain.EventSink) error {
	if sink.ID == "" {
		if err := ensureManagedID(&sink.ID, domain.PrefixEventSink); err != nil {
			return err
		}
	}
	_, err := e.db.Update(ctx, buildStatement(ensureEventSinkStmt,
		sink.ID, string(sink.Type), string(sink.Scope), nullString(sink.ProjectID), sink.URL, sink.Enabled,
	).statement())
	return err
}

// GetEventSinkCursor implements [service.EventStatements].
func (e eventStatements) GetEventSinkCursor(ctx context.Context, sinkID, projectID string) (*domain.EventSinkCursor, error) {
	var cursor *domain.EventSinkCursor
	err := e.db.Query(ctx, buildStatement(getEventSinkCursorStmt, sinkID, projectID).statement(), func(iter *spanner.RowIterator) error {
		var err error
		cursor, err = collectOneRow(iter, func(row *spanner.Row) (*domain.EventSinkCursor, error) {
			var c domain.EventSinkCursor
			if err := row.Columns(&c.SinkID, &c.ProjectID, &c.LastCreatedAt, &c.LastEventID); err != nil {
				return nil, err
			}
			c.LastCreatedAt = c.LastCreatedAt.UTC()
			return &c, nil
		})
		return err
	})
	if err != nil {
		return nil, err
	}
	return cursor, nil
}

// UpsertEventSinkCursor implements [service.EventStatements].
func (e eventStatements) UpsertEventSinkCursor(ctx context.Context, cursor *domain.EventSinkCursor) error {
	if cursor == nil {
		return domain.ErrEventInvalid("missing cursor", nil)
	}
	_, err := e.db.Update(ctx, buildStatement(upsertEventSinkCursorStmt,
		cursor.SinkID, cursor.ProjectID, cursor.LastCreatedAt.UTC(), cursor.LastEventID,
	).statement())
	return err
}

// ListEventsAfterCursor implements [service.EventStatements].
func (e eventStatements) ListEventsAfterCursor(ctx context.Context, projectID string, afterCreatedAt time.Time, afterID string, limit uint32) ([]*domain.Event, error) {
	if limit == 0 {
		limit = 100
	}
	filters := []database.Filter[domain.EventField]{
		database.Equal(database.Col(domain.EventFieldProjectID), projectID),
	}
	if !afterCreatedAt.IsZero() || afterID != "" {
		filters = append(filters, database.CompareGreater(
			database.Term(database.Col(domain.EventFieldCreatedAt), afterCreatedAt.UTC()),
			database.Term(database.Col(domain.EventFieldID), afterID),
		))
	}
	res, err := e.ListEvents(ctx, &database.ListOptions[domain.EventField]{
		Filter: database.And(filters...),
		Pagination: database.Page[domain.EventField]{
			Limit: limit,
			OrderBy: database.OrderBy[domain.EventField]{
				Columns: []database.Column[domain.EventField]{
					database.Col(domain.EventFieldCreatedAt),
					database.Col(domain.EventFieldID),
				},
				Direction: database.OrderAsc,
			},
		},
	})
	if err != nil {
		return nil, err
	}
	return res.Items, nil
}

func (e eventStatements) scanEvent(row *spanner.Row) (*domain.Event, error) {
	var (
		ev                                               domain.Event
		eventType, category                              string
		teamID, actorID, actorType, entityType, entityID spanner.NullString
		requestID, sessionID, flowID                     spanner.NullString
		payload, metadata                                spanner.NullJSON
	)
	if err := row.Columns(
		&ev.ProjectID, &ev.ID, &eventType, &category,
		&ev.OccurredAt, &ev.CreatedAt,
		&teamID, &actorID, &actorType,
		&entityType, &entityID,
		&ev.ClientID, &ev.TokenID, &ev.DelegationType, &ev.DelegationID, &ev.Grantor, &ev.Fingerprint,
		&requestID, &sessionID, &flowID,
		&payload, &metadata,
	); err != nil {
		return nil, err
	}
	ev.EventType = domain.EventType(eventType)
	ev.Category = domain.EventCategory(category)
	ev.OccurredAt = ev.OccurredAt.UTC()
	ev.CreatedAt = ev.CreatedAt.UTC()
	ev.TeamID = spannerNullStringPtr(teamID)
	ev.ActorID = spannerNullStringPtr(actorID)
	if actorType.Valid {
		t := domain.EventActorType(actorType.StringVal)
		ev.ActorType = &t
	}
	ev.EntityType = spannerNullStringPtr(entityType)
	ev.EntityID = spannerNullStringPtr(entityID)
	ev.RequestID = spannerNullStringPtr(requestID)
	ev.SessionID = spannerNullStringPtr(sessionID)
	ev.FlowID = spannerNullStringPtr(flowID)
	payloadBytes, err := decodeNullJSON(payload)
	if err != nil {
		return nil, err
	}
	metadataBytes, err := decodeNullJSON(metadata)
	if err != nil {
		return nil, err
	}
	ev.Payload = events.NormalizeJSON(payloadBytes)
	ev.Metadata = events.NormalizeJSON(metadataBytes)
	return &ev, nil
}

func nullString(p *string) any {
	if p == nil {
		return nil
	}
	return *p
}

func nullActorType(p *domain.EventActorType) any {
	if p == nil {
		return nil
	}
	return string(*p)
}

func spannerNullStringPtr(ns spanner.NullString) *string {
	if !ns.Valid {
		return nil
	}
	s := ns.StringVal
	return &s
}

var _ service.EventStatements = (*eventStatements)(nil)
