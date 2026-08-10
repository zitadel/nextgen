package postgres

import (
	"context"
	"database/sql"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
	"github.com/zitadel/nextgen/internal/storage/events"
)

const (
	insertEventStmt = `
INSERT INTO zitadel_nextgen.events (
    project_id, id, event_type, category,
    occurred_at, created_at,
    team_id, actor_id, actor_type,
    entity_type, entity_id,
    client_id, token_id, delegation_type, delegation_id, grantor, fingerprint,
    request_id, session_id, flow_id,
    payload, metadata
) VALUES (
    $1, $2, $3, $4,
    now() - ($5::bigint * interval '1 nanosecond'), now(),
    $6, $7, $8,
    $9, $10,
    $11, $12, $13, $14, $15, $16,
    $17, $18, $19,
    $20, $21
) RETURNING occurred_at, created_at`

	eventQuery = `SELECT
    project_id, id, event_type, category,
    occurred_at, created_at,
    team_id, actor_id, actor_type,
    entity_type, entity_id,
    client_id, token_id, delegation_type, delegation_id, grantor, fingerprint,
    request_id, session_id, flow_id,
    payload, metadata
FROM zitadel_nextgen.events`

	deleteEventsOlderThanStmt = `
DELETE FROM zitadel_nextgen.events
WHERE project_id = $1 AND created_at < $2`
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
	waitNs := event.OccurredAtWait.Nanoseconds()
	if waitNs < 0 {
		waitNs = 0
	}

	err := e.client.QueryRow(ctx, insertEventStmt,
		event.ProjectID, event.ID, string(event.EventType), string(event.Category),
		waitNs,
		nullString(event.TeamID), nullString(event.ActorID), nullActorType(event.ActorType),
		nullString(event.EntityType), nullString(event.EntityID),
		event.ClientID, event.TokenID, event.DelegationType, event.DelegationID, event.Grantor, event.Fingerprint,
		nullString(event.RequestID), nullString(event.SessionID), nullString(event.FlowID),
		[]byte(payload), []byte(metadata),
	).Scan(&event.OccurredAt, &event.CreatedAt)
	if err != nil {
		return wrapError(err)
	}
	event.OccurredAt = event.OccurredAt.UTC()
	event.CreatedAt = event.CreatedAt.UTC()
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
	entity, err := pgx.CollectExactlyOneRow(rows, e.scanEvent)
	if err != nil {
		return nil, wrapError(err)
	}
	return entity, nil
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
	items, err := pgx.CollectRows(rows, e.scanEvent)
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
	tag, err := e.client.Exec(ctx, deleteEventsOlderThanStmt, projectID, createdBefore.UTC())
	if err != nil {
		return 0, wrapError(err)
	}
	return tag.RowsAffected(), nil
}

func (e eventStatements) scanEvent(row pgx.CollectableRow) (*domain.Event, error) {
	var (
		ev                                                    domain.Event
		eventType, category                                   string
		teamID, actorID, actorType, entityType, entityID      sql.NullString
		requestID, sessionID, flowID                          sql.NullString
		payload, metadata                                     []byte
	)
	if err := row.Scan(
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
	ev.Payload = events.NormalizeJSON(payload)
	ev.Metadata = events.NormalizeJSON(metadata)
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
