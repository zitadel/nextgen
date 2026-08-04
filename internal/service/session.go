package service

import (
	"context"
	"errors"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

//go:generate go tool mockgen -typed -package mocks -destination ./mocks/session.mock.go . SessionService

type SessionService interface {
	Create(ctx context.Context, input CreateSessionInput) (*domain.Session, error)
	Exchange(ctx context.Context, input ExchangeInput) (*domain.Session, error)
	// Get retrieves a session by ID within a project. When the input sets
	// WithUserIdentity, the linked user's identity attributes are hydrated
	// onto Session.User (absent users degrade to a session without identity).
	// errors: domain.ErrSessionNotFound, domain.ErrInternal
	Get(ctx context.Context, input GetSessionInput) (*domain.Session, error)
	List(ctx context.Context, input ListSessionInput) ([]*domain.Session, error)
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
	ProjectID string
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

func (s *sessionService) List(ctx context.Context, input ListSessionInput) ([]*domain.Session, error) {
	//TODO implement me
	return nil, domain.ErrNotImplemented()
}

func (s *sessionService) Delete(ctx context.Context, input DeleteSessionInput) error {
	err := s.v2Pool.Statements().DeleteSessionByID(ctx, input.ProjectID, input.SessionID)
	if err != nil {
		if errors.Is(err, domain.ErrSessionNotFound()) {
			return nil
		}
		return domain.ErrInternal(err).WithMessage("Failed to delete the session.")
	}
	return nil
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
