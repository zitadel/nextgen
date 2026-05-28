package service

import (
	"context"
	"errors"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

type SessionService interface {
	Create(ctx context.Context, input CreateSessionInput) (*domain.Session, error)
	Exchange(ctx context.Context, input ExchangeInput) (*domain.Session, error)
	Get(ctx context.Context, input GetSessionInput) (*domain.Session, error)
	List(ctx context.Context, input ListSessionInput) ([]*domain.Session, error)
	Delete(ctx context.Context, input DeleteSessionInput) error
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
}

type ListSessionInput struct {
	ProjectID string
}

type DeleteSessionInput struct {
	ProjectID string
	SessionID string
}
type sessionService struct {
	pool database.Pool
	repo domain.SessionRepository
	cfg  SessionConfig
}

func (s *sessionService) Create(ctx context.Context, input CreateSessionInput) (*domain.Session, error) {
	session, err := domain.NewSession(input.ProjectID, input.UserAgent)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("Failed to create the session.")
	}
	err = s.repo.Create(ctx, s.pool, session)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("Failed to create the session.")
	}
	return session, nil
}

func (s *sessionService) Exchange(ctx context.Context, input ExchangeInput) (*domain.Session, error) {
	ttl, err := domain.ResolveSessionTTL(input.TTL, s.cfg.DefaultTTL, s.cfg.MaxTTL)
	if err != nil {
		return nil, err
	}
	session, err := s.repo.Exchange(ctx, s.pool, input.ProjectID, input.HandoffToken, input.IdempotencyKey, ttl)
	if err != nil {
		if errors.Is(err, domain.ErrSessionExchangeConflict()) || errors.Is(err, domain.ErrSessionInvalidHandoffToken()) {
			return nil, err
		}
		return nil, domain.ErrInternal(err).WithMessage("Failed to exchange the session.")
	}
	return session, nil
}

func (s *sessionService) Get(ctx context.Context, input GetSessionInput) (*domain.Session, error) {
	session, err := s.repo.Get(ctx, s.pool, input.ProjectID, input.SessionID)
	if err != nil {
		if errors.Is(err, domain.ErrSessionNotFound()) {
			return nil, err
		}
		return nil, domain.ErrInternal(err).WithMessage("Failed to get the session.")
	}
	return session, nil
}

func (s *sessionService) List(ctx context.Context, input ListSessionInput) ([]*domain.Session, error) {
	//TODO implement me
	return nil, domain.ErrNotImplemented()
}

func (s *sessionService) Delete(ctx context.Context, input DeleteSessionInput) error {
	err := s.repo.Delete(ctx, s.pool, input.ProjectID, input.SessionID)
	if err != nil {
		if errors.Is(err, domain.ErrSessionNotFound()) { // TODO: ?
			return nil
		}
		return domain.ErrInternal(err).WithMessage("Failed to delete the session.")
	}
	return nil
}

func NewSessionService(pool database.Pool, repo domain.SessionRepository, cfg SessionConfig) SessionService {
	return &sessionService{
		pool: pool,
		repo: repo,
		cfg:  cfg,
	}
}
