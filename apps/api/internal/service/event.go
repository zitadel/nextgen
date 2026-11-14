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
	ProjectID   string
	Categories  []string
	EventTypes  []string
	ActorID     string
	UserID      string
	ClientID    string
	SessionID   string
	FlowID      string
	RequestID   string
	Fingerprint string
	EntityType  string
	EntityID    string
	TeamID      string
	// OperationIDs and StatusClasses match request.api events by the
	// operation they record and the class of their response status
	// (domain.HTTPStatusClass), each any of the values named.
	OperationIDs  []string
	StatusClasses []string
	CreatedAfter  *time.Time
	CreatedBefore *time.Time
	Order         string
	Limit         int
	PageToken     string
	// PlatformOperator says whether the caller is a platform operator, who
	// reads a project nobody has claimed yet; nil, the caller is not one.
	PlatformOperator PlatformOperatorCheck
}

// PlatformOperatorCheck answers whether the caller is a platform operator
// (ADR 075), who reads every project's events, claimed or not (ADR 049 §4).
// The events gate asks it only of a project that exists and is unclaimed, so
// it may read; a failure is the request's, never a "no".
type PlatformOperatorCheck func(context.Context) (bool, error)

// ListEventsResponse is a cursor page of events.
type ListEventsResponse struct {
	Events        []*domain.Event
	NextPageToken string
}

// eventScanBudget is how many events one index range is read for a filter no
// index holds, per request (events.ScanEach). It is what such a request costs
// at most, and it exceeds the largest page (maxListLimit), so a range in
// which every event matches still fills one.
const eventScanBudget = 1000

// EventService lists and loads audit events (ADR 049).
type EventService struct {
	v2Pool            *DB
	platformProjectID string
	scanBudget        uint32
}

// NewEventService builds the events service. platformProjectID is the
// deployment's platform project, whose events are visible without a claim
// (ADR 049 §4); empty, every project needs one.
func NewEventService(v2Pool *DB, platformProjectID string) *EventService {
	return &EventService{v2Pool: v2Pool, platformProjectID: platformProjectID, scanBudget: eventScanBudget}
}

// List returns events for a claimed project, the platform project, or, to a
// platform operator, any project, with optional filters and keyset pagination
// on (created_at, id). Any other project yields an empty page.
//
// Every list is read as ranges of an index, each no further than the page or
// than eventScanBudget (planEventRead). So a list whose filter no index holds
// whole can return fewer events than the limit, or none, with a token to go
// on from.
func (s *EventService) List(ctx context.Context, req ListEventsRequest) (_ *ListEventsResponse, err error) {
	ctx, end := startSpan(ctx, "EventService.List")
	defer end(&err)

	if req.ProjectID == "" {
		return nil, domain.ErrEventInvalid("project_id is required", nil)
	}

	visible, err := s.projectEventsVisible(ctx, req.ProjectID, req.PlatformOperator)
	if err != nil {
		return nil, err
	}
	if !visible {
		return &ListEventsResponse{Events: []*domain.Event{}}, nil
	}

	read := planEventRead(req)
	opts, err := listEventsOptions(req, read)
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

	stmts := s.v2Pool.Statements()
	var result *database.ListResult[*domain.Event]
	switch {
	case len(read.match) > 0:
		result, err = events.ScanEach(ctx, stmts.ScanEvents, s.fetchEvents(req.ProjectID), opts,
			read.each, read.values, database.And(read.match...), s.scanBudget)
	case len(read.values) > 0:
		result, err = events.ListEach(ctx, stmts.ListEvents, opts, read.each, read.values)
	default:
		result, err = stmts.ListEvents(ctx, opts)
	}
	if err != nil {
		return nil, mapListError(err, "failed to list events")
	}
	return &ListEventsResponse{
		Events:        result.Items,
		NextPageToken: string(result.NextCursor),
	}, nil
}

// Get loads one event by (project_id, id). A miss, and any event of a project
// whose events List does not show (projectEventsVisible), is not found (no
// existence leak).
func (s *EventService) Get(ctx context.Context, projectID, id string, operator PlatformOperatorCheck) (_ *domain.Event, err error) {
	ctx, end := startSpan(ctx, "EventService.Get")
	defer end(&err)

	if projectID == "" {
		return nil, domain.ErrEventInvalid("project_id is required", nil)
	}
	if id == "" {
		return nil, domain.ErrEventInvalid("id is required", nil)
	}

	visible, err := s.projectEventsVisible(ctx, projectID, operator)
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

// projectEventsVisible implements the ADR 049 §4 pre-claim gate: a project's
// events are visible once it holds an active owning-team grant (ADR 046). The
// platform project never does, but has its admins from the start, so its
// events are always visible. A platform operator sees every project's, and is
// asked only about a project that exists and is unclaimed, so no other read
// pays for the question. A project that is gone shows nothing to anyone.
func (s *EventService) projectEventsVisible(ctx context.Context, projectID string, operator PlatformOperatorCheck) (bool, error) {
	if s.platformProjectID != "" && projectID == s.platformProjectID {
		return true, nil
	}
	claim, err := loadProjectClaim(ctx, s.v2Pool.Statements(), projectID)
	if err != nil {
		return false, err
	}
	if claim != projectUnclaimed || operator == nil {
		return claim == projectClaimed, nil
	}
	return operator(ctx)
}

// fetchEvents loads a page's events by id, once a bounded scan has said which
// they are (events.ScanEach).
func (s *EventService) fetchEvents(projectID string) events.FetchFunc {
	return func(ctx context.Context, ids []string) ([]*domain.Event, error) {
		byID := make([]database.Filter[domain.EventField], len(ids))
		for i, id := range ids {
			byID[i] = database.Equal(database.Col(domain.EventFieldID), id)
		}
		found, err := s.v2Pool.Statements().ListEvents(ctx, &database.ListOptions[domain.EventField]{
			Filter: database.And(
				database.Equal(database.Col(domain.EventFieldProjectID), projectID),
				database.Or(byID...),
			),
		})
		if err != nil {
			return nil, err
		}
		return found.Items, nil
	}
}

// eventRead is how one list is read, so that no read goes further than its
// page or its budget, whatever the filter and the data.
type eventRead struct {
	// within is what the index leads with after the project, in every range
	// of the read: one id, or one resource type. Nothing for a read by
	// category, type, operation, status class or time alone.
	within database.Filter[domain.EventField]
	// each is the field read one value at a time, each a range of the index,
	// and merged (events.ListEach): the category, the event type, the status
	// class, or the operation with its status class (events.OperationStatus).
	each   domain.EventField
	values []string
	// match is what the index does not hold. It is tried row by row over the
	// range, no further than the budget (events.ScanEach). Empty, the read is
	// the range itself and stops at the page.
	match []database.Filter[domain.EventField]
}

// planEventRead puts a list onto the index that holds the most of its filter.
// Every index starts with the project and ends in (created_at, id), so the
// time bounds and the page token narrow any of them:
//
//   - A request or a login flow holds few events and has an index by time.
//   - A session, a resource, a user, an actor and a resource type can each
//     hold as many events as the project, most of them of one category, so
//     their indexes hold the category before the time. Their read is a range
//     per category, the ones named or every one, merged.
//   - An operation's index holds it with the status class, as one key
//     (events.OperationStatus), so its failed calls are a range apart from
//     its successful ones. Its read is a range per operation and status
//     class, the classes named or every one.
//   - Several status classes, event types or categories are a range each of
//     the class's, the type's or the category's index, merged.
//
// Of the ids, the first in that order reads, and the resource type reads only
// beside none of them; the others are matched. Without either, operations
// read before status classes, and those before types and categories. What a
// read does not take is matched, as is what no index holds: the application,
// the fingerprint and the team.
func planEventRead(req ListEventsRequest) eventRead {
	var read eventRead
	equal := func(field domain.EventField, value string) database.Filter[domain.EventField] {
		return database.Equal(database.Col(field), value)
	}

	byCategory := false
	for _, id := range []struct {
		field      domain.EventField
		value      string
		byCategory bool
	}{
		{domain.EventFieldRequestID, req.RequestID, false},
		{domain.EventFieldFlowID, req.FlowID, false},
		{domain.EventFieldSessionID, req.SessionID, true},
		{domain.EventFieldEntityID, req.EntityID, true},
		{domain.EventFieldUserID, req.UserID, true},
		{domain.EventFieldActorID, req.ActorID, true},
		{domain.EventFieldEntityType, req.EntityType, true},
	} {
		switch {
		case id.value == "":
		case read.within == nil:
			read.within, byCategory = equal(id.field, id.value), id.byCategory
		default:
			read.match = append(read.match, equal(id.field, id.value))
		}
	}

	// The operation_status keys of the operations named, in the classes
	// named or every class (events.OperationStatus): what a read by
	// operation ranges over, or matches.
	var operations []string
	if len(req.OperationIDs) > 0 {
		classes := req.StatusClasses
		if len(classes) == 0 {
			for _, class := range domain.HTTPStatusClasses() {
				classes = append(classes, string(class))
			}
		}
		for _, operation := range req.OperationIDs {
			for _, class := range classes {
				operations = append(operations, events.OperationStatus(operation, domain.HTTPStatusClass(class)))
			}
		}
	}

	// What the read does not take of the categories, the types and the
	// requests' operations and status classes, in that order.
	matchRest := func(categories, types, requests bool) {
		if categories {
			read.match = appendAnyOf(read.match, domain.EventFieldCategory, req.Categories)
		}
		if types {
			read.match = appendAnyOf(read.match, domain.EventFieldEventType, req.EventTypes)
		}
		if requests && len(operations) > 0 {
			read.match = appendAnyOf(read.match, domain.EventFieldOperationStatus, operations)
		} else if requests {
			read.match = appendAnyOf(read.match, domain.EventFieldStatusClass, req.StatusClasses)
		}
	}

	switch {
	case byCategory:
		categories := req.Categories
		if len(categories) == 0 {
			for _, category := range domain.EventCategories() {
				categories = append(categories, string(category))
			}
		}
		read.each, read.values = domain.EventFieldCategory, categories
		matchRest(false, true, true)
	case read.within != nil:
		matchRest(true, true, true)
	case len(operations) > 0:
		read.each, read.values = domain.EventFieldOperationStatus, operations
		matchRest(true, true, false)
	case len(req.StatusClasses) > 0:
		read.each, read.values = domain.EventFieldStatusClass, req.StatusClasses
		matchRest(true, true, false)
	case len(req.EventTypes) > 0:
		read.each, read.values = domain.EventFieldEventType, req.EventTypes
		matchRest(true, false, false)
	case len(req.Categories) > 0:
		read.each, read.values = domain.EventFieldCategory, req.Categories
	}

	for _, unindexed := range []struct {
		field domain.EventField
		value string
	}{
		{domain.EventFieldClientID, req.ClientID},
		{domain.EventFieldFingerprint, req.Fingerprint},
		{domain.EventFieldTeamID, req.TeamID},
	} {
		if unindexed.value != "" {
			read.match = append(read.match, equal(unindexed.field, unindexed.value))
		}
	}
	return read
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

// listEventsOptions is the part of a list every one of its reads shares: the
// range read.within names, the time bounds, the order, the limit and the page
// token. The values read one at a time and what is matched are the read's.
func listEventsOptions(req ListEventsRequest, read eventRead) (*database.ListOptions[domain.EventField], error) {
	filters := make([]database.Filter[domain.EventField], 0, 4)
	filters = append(filters, database.Equal(database.Col(domain.EventFieldProjectID), req.ProjectID))
	if read.within != nil {
		filters = append(filters, read.within)
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

	var orderBy database.OrderBy[domain.EventField]
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
