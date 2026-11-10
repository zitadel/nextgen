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
	Order         string
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
func (s *EventService) List(ctx context.Context, req ListEventsRequest) (_ *ListEventsResponse, err error) {
	ctx, end := startSpan(ctx, "EventService.List")
	defer end(&err)

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
	if opts.Pagination.OrderBy.Direction == database.OrderAsc {
		// Paging forward, a token passes every event before its page. An
		// event that commits behind a page would be skipped for good, so an
		// ascending list stops where events are still settling.
		settled, err := s.v2Pool.Statements().EventsSettledBefore(ctx, req.ProjectID)
		if err != nil {
			return nil, domain.ErrInternal(err).WithMessage("failed to list events")
		}
		if !settled.IsZero() {
			opts.Filter = database.And(opts.Filter, database.LessThan(database.Col(domain.EventFieldCreatedAt), settled))
		}
	}

	list := s.v2Pool.Statements().ListEvents
	var result *database.ListResult[*domain.Event]
	if field, values := readEach(req); len(values) > 1 {
		result, err = events.ListEach(ctx, list, opts, field, values)
	} else {
		result, err = list(ctx, opts)
	}
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
func (s *EventService) Get(ctx context.Context, projectID, id string) (_ *domain.Event, err error) {
	ctx, end := startSpan(ctx, "EventService.Get")
	defer end(&err)

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

// readEach says which field's values List reads one at a time and merges
// (events.ListEach), so that each read is a range of one index, in order, and
// stops at the page. It returns no values for a list that one read serves.
//
//   - A request, a session, a login flow and a resource each have an index
//     by time: one read. With nothing else asked it is that range and stops
//     at the page. Whatever else is asked is matched row by row over it, so
//     the read is as long as the events the id holds, and a session or a
//     resource can hold as many as the project. Logs sends each on its own.
//   - One actor's events are indexed by category, then time. An actor's
//     events are mostly its API requests, so a read across categories, named
//     or not, reads each category on its own.
//   - Several categories are a range each of the category index.
//   - Several event types, with nothing beside them, are a range each of the
//     type index.
//
// Anything else is one read with every filter in it, as before. That includes
// the combinations no index serves in order, such as a type beside a category
// or an actor.
func readEach(req ListEventsRequest) (domain.EventField, []string) {
	if req.RequestID != "" || req.SessionID != "" || req.FlowID != "" || req.EntityID != "" {
		return domain.EventFieldUnspecified, nil
	}
	if len(req.EventTypes) > 0 {
		if len(req.EventTypes) > 1 && len(req.Categories) == 0 && req.ActorID == "" {
			return domain.EventFieldEventType, req.EventTypes
		}
		return domain.EventFieldUnspecified, nil
	}
	if req.ActorID != "" && len(req.Categories) == 0 {
		categories := domain.EventCategories()
		all := make([]string, len(categories))
		for i, category := range categories {
			all[i] = string(category)
		}
		return domain.EventFieldCategory, all
	}
	if len(req.Categories) > 1 {
		return domain.EventFieldCategory, req.Categories
	}
	return domain.EventFieldUnspecified, nil
}

// appendAnyOf adds "field is any of values" to filters; nothing for no values.
func appendAnyOf(filters []database.Filter[domain.EventField], field domain.EventField, values []string) []database.Filter[domain.EventField] {
	switch len(values) {
	case 0:
		return filters
	case 1:
		return append(filters, database.Equal(database.Col(field), values[0]))
	}
	ors := make([]database.Filter[domain.EventField], 0, len(values))
	for _, value := range values {
		ors = append(ors, database.Equal(database.Col(field), value))
	}
	return append(filters, database.Or(ors...))
}

func listEventsOptions(req ListEventsRequest) (*database.ListOptions[domain.EventField], error) {
	filters := make([]database.Filter[domain.EventField], 0, 16)
	filters = append(filters, database.Equal(database.Col(domain.EventFieldProjectID), req.ProjectID))

	// The values List reads one at a time are not part of the filter:
	// events.ListEach adds each to its own read.
	each, _ := readEach(req)
	if each != domain.EventFieldCategory {
		filters = appendAnyOf(filters, domain.EventFieldCategory, req.Categories)
	}
	if each != domain.EventFieldEventType {
		filters = appendAnyOf(filters, domain.EventFieldEventType, req.EventTypes)
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
		filters = append(filters, database.GreaterThanOrEqual(database.Col(domain.EventFieldCreatedAt), *req.CreatedAfter))
	}
	if req.CreatedBefore != nil {
		filters = append(filters, database.LessThan(database.Col(domain.EventFieldCreatedAt), *req.CreatedBefore))
	}

	var cursor []byte
	if req.PageToken != "" {
		cursor = []byte(req.PageToken)
	}

	orderBy := events.CreatedAtDesc()
	switch req.Order {
	case "", "desc":
		orderBy = events.CreatedAtDesc()
	case "asc":
		orderBy = events.CreatedAtAsc()
	default:
		return nil, domain.ErrEventInvalid("order must be asc or desc", nil)
	}

	return &database.ListOptions[domain.EventField]{
		Filter: database.And(filters...),
		Pagination: database.Page[domain.EventField]{
			Limit:   uint32(normalizeLimit(req.Limit)),
			OrderBy: orderBy,
			Cursor:  cursor,
		},
	}, nil
}
