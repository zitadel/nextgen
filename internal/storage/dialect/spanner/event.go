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

	insertEventStmt = `
INSERT INTO events (
    project_id, id, event_type, category,
    occurred_at, created_at,
    team_id, actor_id, actor_type,
    entity_type, entity_id,
    client_id, token_id, delegation_type, delegation_id, grantor, fingerprint,
    request_id, session_id, flow_id,
    payload, metadata
) VALUES (
    @p1, @p2, @p3, @p4,
    TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @p5 NANOSECOND), CURRENT_TIMESTAMP(),
    @p6, @p7, @p8,
    @p9, @p10,
    @p11, @p12, @p13, @p14, @p15, @p16,
    @p17, @p18, @p19,
    @p20, @p21
) THEN RETURN occurred_at, created_at`

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
WHERE project_id = @p1 AND created_at < @p2`

	ensureEventSinkStmt = `
INSERT INTO event_sinks (id, type, scope, project_id, url, enabled)
VALUES (@p1, @p2, @p3, @p4, @p5, @p6)
ON CONFLICT (id) DO UPDATE SET
    type = EXCLUDED.type,
    scope = EXCLUDED.scope,
    project_id = EXCLUDED.project_id,
    url = EXCLUDED.url,
    enabled = EXCLUDED.enabled`

	recordEventDeliveryStmt = `
INSERT INTO event_deliveries (project_id, event_id, sink_id) VALUES (@p1, @p2, @p3)
ON CONFLICT (project_id, event_id, sink_id) DO NOTHING`

	listUndeliveredEventsStmt = `
SELECT
    e.project_id, e.id, e.event_type, e.category,
    e.occurred_at, e.created_at,
    e.team_id, e.actor_id, e.actor_type,
    e.entity_type, e.entity_id,
    e.client_id, e.token_id, e.delegation_type, e.delegation_id, e.grantor, e.fingerprint,
    e.request_id, e.session_id, e.flow_id,
    e.payload, e.metadata
FROM events e
WHERE NOT EXISTS (
    SELECT 1 FROM event_deliveries d
    WHERE d.project_id = e.project_id AND d.event_id = e.id AND d.sink_id = @p1
)
ORDER BY e.created_at, e.id
LIMIT @p2`
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
	waitNs := event.OccurredAtWait.Nanoseconds()
	if waitNs < 0 {
		waitNs = 0
	}

	stmt := buildStatement(insertEventStmt,
		event.ProjectID, event.ID, string(event.EventType), string(event.Category),
		waitNs,
		nullString(event.TeamID), nullString(event.ActorID), nullActorType(event.ActorType),
		nullString(event.EntityType), nullString(event.EntityID),
		event.ClientID, event.TokenID, event.DelegationType, event.DelegationID, event.Grantor, event.Fingerprint,
		nullString(event.RequestID), nullString(event.SessionID), nullString(event.FlowID),
		payload, metadata,
	).statement()

	err = e.db.Write(ctx, stmt, func(iter *spanner.RowIterator) error {
		_, err := collectOneRow(iter, func(row *spanner.Row) (struct{}, error) {
			if err := row.Columns(&event.OccurredAt, &event.CreatedAt); err != nil {
				return struct{}{}, err
			}
			event.OccurredAt = event.OccurredAt.UTC()
			event.CreatedAt = event.CreatedAt.UTC()
			return struct{}{}, nil
		})
		return err
	})
	if err != nil {
		return err
	}
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
func (e eventStatements) DeleteEventsOlderThan(ctx context.Context, projectID string, createdBefore time.Time) (int64, error) {
	n, err := e.db.Update(ctx, buildStatement(deleteEventsOlderThanStmt, projectID, createdBefore.UTC()).statement())
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

// RecordEventDelivery implements [service.EventStatements].
func (e eventStatements) RecordEventDelivery(ctx context.Context, projectID, eventID, sinkID string) error {
	_, err := e.db.Update(ctx, buildStatement(recordEventDeliveryStmt, projectID, eventID, sinkID).statement())
	return err
}

// ListUndeliveredEvents implements [service.EventStatements].
func (e eventStatements) ListUndeliveredEvents(ctx context.Context, sinkID string, limit uint32) ([]*domain.Event, error) {
	if limit == 0 {
		limit = 100
	}
	var items []*domain.Event
	err := e.db.Query(ctx, buildStatement(listUndeliveredEventsStmt, sinkID, int64(limit)).statement(), func(iter *spanner.RowIterator) error {
		var err error
		items, err = collectRows(iter, e.scanEvent)
		return err
	})
	return items, err
}

func (e eventStatements) scanEvent(row *spanner.Row) (*domain.Event, error) {
	var (
		ev                                                    domain.Event
		eventType, category                                   string
		teamID, actorID, actorType, entityType, entityID      spanner.NullString
		requestID, sessionID, flowID                          spanner.NullString
		payload, metadata                                     spanner.NullJSON
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
