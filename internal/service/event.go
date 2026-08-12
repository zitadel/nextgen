package service

import (
	"context"
	"errors"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/events"
)

// ListEventsRequest is the input for listing project audit events (ADR 049).
type ListEventsRequest struct {
	ProjectID     string
	Categories    []string
	EventTypes    []string
	ActorID       string
	ClientID      string
	SessionID     string
	FlowID        string
	RequestID     string
	Fingerprint   string
	EntityType    string
	EntityID      string
	TeamID        string
	CreatedAfter  *time.Time
	CreatedBefore *time.Time
	Limit         int
	PageToken     string
}

// ListEventsResponse is a cursor page of events.
type ListEventsResponse struct {
	Events        []*domain.Event
	NextPageToken string
}

// EventService lists and loads audit events (ADR 049).
type EventService struct {
	v2Pool *DB
}

func NewEventService(v2Pool *DB) *EventService {
	return &EventService{v2Pool: v2Pool}
}

// List returns events for a claimed project with optional filters and keyset
// pagination on (created_at, id). Pre-claim projects yield an empty page.
func (s *EventService) List(ctx context.Context, req ListEventsRequest) (*ListEventsResponse, error) {
	if req.ProjectID == "" {
		return nil, domain.ErrEventInvalid("project_id is required", nil)
	}

	visible, err := s.projectEventsVisible(ctx, req.ProjectID)
	if err != nil {
		return nil, err
	}
	if !visible {
		return &ListEventsResponse{Events: []*domain.Event{}}, nil
	}

	opts, err := listEventsOptions(req)
	if err != nil {
		return nil, err
	}

	result, err := s.v2Pool.Statements().ListEvents(ctx, opts)
	if err != nil {
		return nil, mapListError(err, "failed to list events")
	}
	return &ListEventsResponse{
		Events:        result.Items,
		NextPageToken: string(result.NextCursor),
	}, nil
}

// Get loads one event by (project_id, id). Pre-claim projects and misses
// return not found (no existence leak).
func (s *EventService) Get(ctx context.Context, projectID, id string) (*domain.Event, error) {
	if projectID == "" {
		return nil, domain.ErrEventInvalid("project_id is required", nil)
	}
	if id == "" {
		return nil, domain.ErrEventInvalid("id is required", nil)
	}

	visible, err := s.projectEventsVisible(ctx, projectID)
	if err != nil {
		return nil, err
	}
	if !visible {
		return nil, domain.ErrEventNotFound()
	}

	event, err := s.v2Pool.Statements().GetEventByID(ctx, projectID, id)
	if err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return nil, domain.ErrEventNotFound()
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to get event")
	}
	return event, nil
}

// projectEventsVisible implements the ADR 049 pre-claim gate. Claim is a
// project→team grant (ADR 046), denormalized onto resource_scope_index.team_id
// for the project row when claim completes. Until that team stamp exists the
// project is treated as pre-claim: list returns empty, get returns not found.
func (s *EventService) projectEventsVisible(ctx context.Context, projectID string) (bool, error) {
	return projectIsClaimed(ctx, s.v2Pool.Statements(), projectID)
}

func listEventsOptions(req ListEventsRequest) (*database.ListOptions[domain.EventField], error) {
	filters := make([]database.Filter[domain.EventField], 0, 16)
	filters = append(filters, database.Equal(database.Col(domain.EventFieldProjectID), req.ProjectID))

	if len(req.Categories) > 0 {
		ors := make([]database.Filter[domain.EventField], 0, len(req.Categories))
		for _, c := range req.Categories {
			ors = append(ors, database.Equal(database.Col(domain.EventFieldCategory), c))
		}
		filters = append(filters, database.Or(ors...))
	}
	if len(req.EventTypes) > 0 {
		ors := make([]database.Filter[domain.EventField], 0, len(req.EventTypes))
		for _, t := range req.EventTypes {
			ors = append(ors, database.Equal(database.Col(domain.EventFieldEventType), t))
		}
		filters = append(filters, database.Or(ors...))
	}
	if req.ActorID != "" {
		filters = append(filters, database.Equal(database.Col(domain.EventFieldActorID), req.ActorID))
	}
	if req.ClientID != "" {
		filters = append(filters, database.Equal(database.Col(domain.EventFieldClientID), req.ClientID))
	}
	if req.SessionID != "" {
		filters = append(filters, database.Equal(database.Col(domain.EventFieldSessionID), req.SessionID))
	}
	if req.FlowID != "" {
		filters = append(filters, database.Equal(database.Col(domain.EventFieldFlowID), req.FlowID))
	}
	if req.RequestID != "" {
		filters = append(filters, database.Equal(database.Col(domain.EventFieldRequestID), req.RequestID))
	}
	if req.Fingerprint != "" {
		filters = append(filters, database.Equal(database.Col(domain.EventFieldFingerprint), req.Fingerprint))
	}
	if req.EntityType != "" {
		filters = append(filters, database.Equal(database.Col(domain.EventFieldEntityType), req.EntityType))
	}
	if req.EntityID != "" {
		filters = append(filters, database.Equal(database.Col(domain.EventFieldEntityID), req.EntityID))
	}
	if req.TeamID != "" {
		filters = append(filters, database.Equal(database.Col(domain.EventFieldTeamID), req.TeamID))
	}
	if req.CreatedAfter != nil {
		// Inclusive lower bound: created_at >= after ≡ equal OR greater.
		col := database.Col(domain.EventFieldCreatedAt)
		filters = append(filters, database.Or(
			database.Equal(col, *req.CreatedAfter),
			database.GreaterThan(col, *req.CreatedAfter),
		))
	}
	if req.CreatedBefore != nil {
		filters = append(filters, database.LessThan(database.Col(domain.EventFieldCreatedAt), *req.CreatedBefore))
	}

	var cursor []byte
	if req.PageToken != "" {
		cursor = []byte(req.PageToken)
	}

	return &database.ListOptions[domain.EventField]{
		Filter: database.And(filters...),
		Pagination: database.Page[domain.EventField]{
			Limit:   uint32(normalizeLimit(req.Limit)),
			OrderBy: events.CreatedAtAsc(),
			Cursor:  cursor,
		},
	}, nil
}
