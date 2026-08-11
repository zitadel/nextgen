package service

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

//go:generate go tool mockgen -typed -package mocks -destination ./mocks/session.mock.go . SessionService

const (
	sessionFieldCreatedAt = "created_at"
	sessionFieldUserID    = "user_id"
	sessionFieldState     = "state"

	sessionStateBuilding = "building"
	sessionStateActive   = "active"
	sessionStateExpired  = "expired"
)

type SessionService interface {
	Create(ctx context.Context, input CreateSessionInput) (*domain.Session, error)
	Exchange(ctx context.Context, input ExchangeInput) (*domain.Session, error)
	// Get retrieves a session by ID within a project. When the input sets
	// WithUserIdentity, the linked user's identity attributes are hydrated
	// onto Session.User (absent users degrade to a session without identity).
	// errors: domain.ErrSessionNotFound, domain.ErrInternal
	Get(ctx context.Context, input GetSessionInput) (*domain.Session, error)
	// List returns the project's sessions matching the input's filters,
	// errors: domain.ErrProjectMissingID, domain.ErrRequestInvalid, domain.ErrNotImplemented, domain.ErrInternal
	List(ctx context.Context, input ListSessionInput) (*ListSessionsResponse, error)
	Delete(ctx context.Context, input DeleteSessionInput) error
}

// UserIdentityReader is the secondary port Get uses to hydrate the identity
// attributes of a session's linked user.
type UserIdentityReader interface {
	GetIdentity(ctx context.Context, projectID, userID string, attributeKeys ...string) (*domain.User, error)
}

type CreateSessionInput struct {
	ProjectID string
	UserAgent *domain.UserAgent
}

type ExchangeInput struct {
	ProjectID      string
	HandoffToken   string
	IdempotencyKey *string
	// TTL is optional; nil uses the configured default.
	TTL *time.Duration
}

type GetSessionInput struct {
	ProjectID string
	SessionID string
	// WithUserIdentity hydrates the linked user's identity attributes
	// (domain.IdentityAttributeKeys) onto Session.User. Set by reads that
	// render the signed-in identity (GET /sessions/me).
	WithUserIdentity bool
}

type ListSessionInput struct {
	// ProjectID restricts results to that single project. Handlers set it from
	// the caller's scope. Required.
	ProjectID string
	Limit     int
	PageToken string
	Sorting   *Sorting // optional; defaults to createdAt desc (newest first)
	Filters   []Filter
}

// ListSessionsResponse is the output for listing sessions.
type ListSessionsResponse struct {
	Sessions      []*domain.Session
	NextPageToken string
}

type DeleteSessionInput struct {
	ProjectID string
	SessionID string
}

type sessionService struct {
	v2Pool StatementPool
	users  UserIdentityReader
	cfg    SessionConfig
}

func (s *sessionService) Create(ctx context.Context, input CreateSessionInput) (*domain.Session, error) {
	session, err := domain.NewSession(input.ProjectID, input.UserAgent)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("Failed to create the session.")
	}
	if err := s.v2Pool.Statements().CreateSession(ctx, session); err != nil {
		return nil, domain.ErrInternal(err).WithMessage("Failed to create the session.")
	}
	return session, nil
}

func (s *sessionService) Exchange(ctx context.Context, input ExchangeInput) (*domain.Session, error) {
	ttl, err := domain.ResolveSessionTTL(input.TTL, s.cfg.DefaultTTL, s.cfg.MaxTTL)
	if err != nil {
		return nil, err
	}
	session, err := s.v2Pool.Statements().ExchangeSession(ctx, input.ProjectID, input.HandoffToken, input.IdempotencyKey, ttl)
	if err != nil {
		if errors.Is(err, domain.ErrSessionExchangeConflict()) || errors.Is(err, domain.ErrSessionInvalidHandoffToken()) {
			return nil, err
		}
		return nil, domain.ErrInternal(err).WithMessage("Failed to exchange the session.")
	}
	return session, nil
}

func (s *sessionService) Get(ctx context.Context, input GetSessionInput) (*domain.Session, error) {
	session, err := s.v2Pool.Statements().GetSessionByID(ctx, input.ProjectID, input.SessionID)
	if err != nil {
		if errors.Is(err, domain.ErrSessionNotFound()) {
			return nil, err
		}
		return nil, domain.ErrInternal(err).WithMessage("Failed to get the session.")
	}
	if !input.WithUserIdentity || session.UserID == nil {
		return session, nil
	}
	user, err := s.users.GetIdentity(ctx, input.ProjectID, *session.UserID, domain.IdentityAttributeKeys...)
	if err != nil {
		// A session may outlive its user; render it without an identity then.
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return session, nil
		}
		return nil, domain.ErrInternal(err).WithMessage("Failed to load the session user.")
	}
	session.User = user
	return session, nil
}

func (s *sessionService) List(ctx context.Context, input ListSessionInput) (*ListSessionsResponse, error) {
	if input.ProjectID == "" {
		return nil, domain.ErrProjectMissingID()
	}

	// One expiry cutoff for all state predicates in this request. Session state
	// is computed from a clock, never stored, so other readers still disagree
	// near expiry: the next page binds a fresh now, and serialization
	// recomputes State() later.
	now := time.Now().UTC()
	filters := make([]database.Filter[domain.SessionField], 0, len(input.Filters)+1)
	filters = append(filters, database.Equal(database.Col(domain.SessionFieldProjectID), input.ProjectID))
	for _, f := range input.Filters {
		filter, err := sessionFilter(f, now)
		if err != nil {
			return nil, err
		}
		filters = append(filters, filter)
	}

	// Newest first by default.
	orderBy, err := listOrderBy(input.Sorting, domain.SessionFieldCreatedAt, database.OrderDesc, sessionSortField, domain.SessionFieldID)
	if err != nil {
		return nil, err
	}

	var cursor []byte
	if input.PageToken != "" {
		cursor = []byte(input.PageToken)
	}

	result, err := s.v2Pool.Statements().ListSessions(ctx, &database.ListOptions[domain.SessionField]{
		Filter: database.And(filters...),
		Pagination: database.Page[domain.SessionField]{
			Limit:   uint32(normalizeLimit(input.Limit)),
			OrderBy: orderBy,
			Cursor:  cursor,
		},
	})
	if err != nil {
		return nil, mapListError(err, "failed to list sessions")
	}

	return &ListSessionsResponse{
		Sessions:      result.Items,
		NextPageToken: string(result.NextCursor),
	}, nil
}

// sessionSortField maps an API sort field name to its [domain.SessionField].
func sessionSortField(field string) (domain.SessionField, error) {
	switch field {
	case sessionFieldCreatedAt:
		return domain.SessionFieldCreatedAt, nil
	case sessionFieldUserID:
		return domain.SessionFieldUserID, nil
	default:
		return domain.SessionFieldUnspecified, domain.ErrRequestInvalid().WithDetails(fmt.Sprintf("unknown field %q", field))
	}
}

// sessionFilter maps an API filter predicate to a storage filter. Operations
// the filter layer cannot express return [domain.ErrNotImplemented]; invalid
// field/operation/value combinations return [domain.ErrRequestInvalid].
func sessionFilter(f Filter, now time.Time) (database.Filter[domain.SessionField], error) {
	switch f.Field {
	case sessionFieldUserID:
		value, ok := f.Value.(string)
		if !ok {
			return nil, domain.ErrRequestInvalid().WithDetails("user_id filter value must be a string")
		}
		return stringFilter(f.Operation, database.Col(domain.SessionFieldUserID), value)
	case sessionFieldCreatedAt:
		return createdAtFilter(f.Operation, database.Col(domain.SessionFieldCreatedAt), f.Value)
	case sessionFieldState:
		value, ok := f.Value.(string)
		if !ok {
			return nil, domain.ErrRequestInvalid().WithDetails("state filter value must be a string")
		}
		return sessionStateFilter(f.Operation, value, now)
	default:
		return nil, domain.ErrRequestInvalid().WithDetails(fmt.Sprintf("unknown field %q", f.Field))
	}
}

// sessionStateFilter expresses [domain.Session.State], which is computed and
// not stored, over stored columns:
// expired = expires_at < now(),
// building = user_id is NULL and expires_at >= now()
// active = expires_at >= now() and user_id is not NULL
func sessionStateFilter(op, state string, now time.Time) (database.Filter[domain.SessionField], error) {
	switch op {
	case filterOpEquals:
	case filterOpNotEquals:
		// todo (grvijayan): update when the operation is supported
		return nil, domain.ErrNotImplemented().WithDetails(fmt.Sprintf("operation %q is not supported", op))
	case filterOpContains, filterOpNotContains, filterOpLessThan, filterOpGreaterThan, filterOpLessThanOrEqual, filterOpGreaterThanOrEqual:
		return nil, domain.ErrRequestInvalid().WithDetails(fmt.Sprintf("operation %q is not valid for this field", op))
	default:
		return nil, domain.ErrRequestInvalid().WithDetails(fmt.Sprintf("unknown operation %q", op))
	}

	expiresAt := database.Col(domain.SessionFieldExpiresAt)
	userID := database.Col(domain.SessionFieldUserID)
	// todo (grvijayan): replace with a greater-or-equal compare once the filter layer supports it
	activeSessionsFilter := database.Or(database.GreaterThan(expiresAt, now), database.Equal(expiresAt, now))

	switch state {
	case sessionStateExpired:
		return database.LessThan(expiresAt, now), nil
	case sessionStateBuilding:
		// todo (@grvijayan) review: user_id stands in for State()'s factor test.
		// A nil value binds SQL NULL: user_id IS NULL until the exchange.
		return database.And(activeSessionsFilter, database.Equal(userID, nil)), nil
	case sessionStateActive:
		// GreaterThan nil compiles to user_id IS NOT NULL: ordered compares
		// place every value beyond the NULL block.
		return database.And(activeSessionsFilter, database.GreaterThan(userID, nil)), nil
	default:
		return nil, domain.ErrRequestInvalid().WithDetails(fmt.Sprintf("unknown state %q", state))
	}
}

func (s *sessionService) Delete(ctx context.Context, input DeleteSessionInput) error {
	return s.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		err := tx.Statements().DeleteSessionByID(ctx, input.ProjectID, input.SessionID)
		if err != nil && !errors.Is(err, domain.ErrSessionNotFound()) {
			return domain.ErrInternal(err).WithMessage("Failed to delete the session.")
		}

		if err := tx.Statements().DeleteTokensBySessionID(ctx, input.ProjectID, input.SessionID); err != nil {
			return domain.ErrInternal(err).WithMessage("Failed to revoke session tokens.")
		}

		return nil
	})
}

func NewSessionService(v2Pool StatementPool, users UserIdentityReader, cfg SessionConfig) SessionService {
	return &sessionService{
		v2Pool: v2Pool,
		users:  users,
		cfg:    cfg,
	}
}

// SessionStatementsResolver adapts StatementPool to SessionResolver.
type SessionStatementsResolver struct {
	Pool StatementPool
}

func (r SessionStatementsResolver) Get(ctx context.Context, projectID, sessionID string) (*domain.Session, error) {
	return r.Pool.Statements().GetSessionByID(ctx, projectID, sessionID)
}
