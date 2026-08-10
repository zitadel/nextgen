package sqlite

import (
	"context"
	"database/sql"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
	"github.com/zitadel/nextgen/internal/storage/events"
)

const (
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
    ?, ?, ?, ?,
    ?, ?,
    ?, ?, ?,
    ?, ?,
    ?, ?, ?, ?, ?, ?,
    ?, ?, ?,
    ?, ?
) RETURNING occurred_at, created_at`

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
WHERE project_id = ? AND created_at < ?`

	ensureEventSinkStmt = `
INSERT INTO event_sinks (id, type, scope, project_id, url, enabled)
VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
    type = excluded.type,
    scope = excluded.scope,
    project_id = excluded.project_id,
    url = excluded.url,
    enabled = excluded.enabled`

	recordEventDeliveryStmt = `
INSERT OR IGNORE INTO event_deliveries (project_id, event_id, sink_id, delivered_at)
VALUES (?, ?, ?, ?)`

	listUndeliveredEventsStmt = eventQuery + `
 WHERE NOT EXISTS (
    SELECT 1 FROM event_deliveries d
    WHERE d.project_id = events.project_id AND d.event_id = events.id AND d.sink_id = ?
 )
 ORDER BY created_at, id
 LIMIT ?`
)

type eventStatements struct{ statement }

func newEventStatements(client queryExecutor) eventStatements {
	return eventStatements{statement: statement{client: client}}
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
	payload := events.NormalizeJSON(event.Payload)
	metadata := events.NormalizeJSON(event.Metadata)
	createdNano := nowUnixNano()
	waitNs := event.OccurredAtWait.Nanoseconds()
	if waitNs < 0 {
		waitNs = 0
	}
	occurredNano := createdNano - waitNs

	var occurredOut, createdOut int64
	err := e.client.QueryRow(ctx, insertEventStmt,
		event.ProjectID, event.ID, string(event.EventType), string(event.Category),
		occurredNano, createdNano,
		nullString(event.TeamID), nullString(event.ActorID), nullActorType(event.ActorType),
		nullString(event.EntityType), nullString(event.EntityID),
		event.ClientID, event.TokenID, event.DelegationType, event.DelegationID, event.Grantor, event.Fingerprint,
		nullString(event.RequestID), nullString(event.SessionID), nullString(event.FlowID),
		string(payload), string(metadata),
	).Scan(&occurredOut, &createdOut)
	if err != nil {
		return wrapError(err)
	}
	event.OccurredAt = timeFromUnixNano(occurredOut)
	event.CreatedAt = timeFromUnixNano(createdOut)
	event.Payload = payload
	event.Metadata = metadata
	return nil
}

// GetEventByID implements [service.EventStatements].
func (e eventStatements) GetEventByID(ctx context.Context, projectID, id string) (*domain.Event, error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, eventQuery, &database.ListOptions[domain.EventField]{
		Filter: database.And(
			database.Equal(database.Col(domain.EventFieldProjectID), projectID),
			database.Equal(database.Col(domain.EventFieldID), id),
		),
	}, events.Schema); err != nil {
		return nil, err
	}
	rows, err := e.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}
	defer rows.Close()
	item, err := collectExactlyOneRow(rows, scanEvent)
	if err != nil {
		return nil, wrapError(err)
	}
	return item, nil
}

// ListEvents implements [service.EventStatements].
func (e eventStatements) ListEvents(ctx context.Context, filter *database.ListOptions[domain.EventField]) (*database.ListResult[*domain.Event], error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, eventQuery, filter, events.Schema); err != nil {
		return nil, err
	}
	rows, err := e.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}
	defer rows.Close()
	items, err := collectRows(rows, scanEvent)
	if err != nil {
		return nil, wrapError(err)
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
	res, err := e.client.Exec(ctx, deleteEventsOlderThanStmt, projectID, createdBefore.UTC().UnixNano())
	if err != nil {
		return 0, wrapError(err)
	}
	return res.RowsAffected()
}

// EnsureEventSink implements [service.EventStatements].
func (e eventStatements) EnsureEventSink(ctx context.Context, sink *domain.EventSink) error {
	if sink.ID == "" {
		if err := ensureManagedID(&sink.ID, domain.PrefixEventSink); err != nil {
			return err
		}
	}
	enabled := 0
	if sink.Enabled {
		enabled = 1
	}
	_, err := e.client.Exec(ctx, ensureEventSinkStmt,
		sink.ID, string(sink.Type), string(sink.Scope), nullString(sink.ProjectID), sink.URL, enabled,
	)
	return wrapError(err)
}

// RecordEventDelivery implements [service.EventStatements].
func (e eventStatements) RecordEventDelivery(ctx context.Context, projectID, eventID, sinkID string) error {
	_, err := e.client.Exec(ctx, recordEventDeliveryStmt, projectID, eventID, sinkID, nowUnixNano())
	return wrapError(err)
}

// ListUndeliveredEvents implements [service.EventStatements].
func (e eventStatements) ListUndeliveredEvents(ctx context.Context, sinkID string, limit uint32) ([]*domain.Event, error) {
	if limit == 0 {
		limit = 100
	}
	rows, err := e.client.Query(ctx, listUndeliveredEventsStmt, sinkID, limit)
	if err != nil {
		return nil, wrapError(err)
	}
	defer rows.Close()
	return collectRows(rows, scanEvent)
}

func scanEvent(row *sql.Rows) (*domain.Event, error) {
	var (
		ev                                                    domain.Event
		eventType, category                                   string
		teamID, actorID, actorType, entityType, entityID      sql.NullString
		requestID, sessionID, flowID                          sql.NullString
		occurredNano, createdNano                             int64
		payload, metadata                                     string
	)
	if err := row.Scan(
		&ev.ProjectID, &ev.ID, &eventType, &category,
		&occurredNano, &createdNano,
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
	ev.OccurredAt = timeFromUnixNano(occurredNano)
	ev.CreatedAt = timeFromUnixNano(createdNano)
	ev.TeamID = nullStringPtr(teamID)
	ev.ActorID = nullStringPtr(actorID)
	if actorType.Valid {
		t := domain.EventActorType(actorType.String)
		ev.ActorType = &t
	}
	ev.EntityType = nullStringPtr(entityType)
	ev.EntityID = nullStringPtr(entityID)
	ev.RequestID = nullStringPtr(requestID)
	ev.SessionID = nullStringPtr(sessionID)
	ev.FlowID = nullStringPtr(flowID)
	ev.Payload = events.NormalizeJSON([]byte(payload))
	ev.Metadata = events.NormalizeJSON([]byte(metadata))
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

func nullStringPtr(ns sql.NullString) *string {
	if !ns.Valid {
		return nil
	}
	s := ns.String
	return &s
}

var _ service.EventStatements = (*eventStatements)(nil)
