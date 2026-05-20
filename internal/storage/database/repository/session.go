package repository

import (
	"context"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/postgres"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/spanner"
)

// NewSessionRepository returns a dialect-specific implementation of [domain.SessionRepository].
func NewSessionRepository(pool database.QueryExecutor) domain.SessionRepository {
	switch pool.(type) {
	case spanner.SpannerPooler:
		return &spannerSession{}
	case postgres.PostgresPooler:
		return &pgSession{}
	}
	panic("NewSessionRepository: unsupported pool type")
}

// ── Postgres implementation ───────────────────────────────────────────────────

type pgSession struct{}

func (a *pgSession) Create(ctx context.Context, q database.QueryExecutor, session *domain.Session) error {
	//TODO implement me
	panic("implement me")
}

func (a *pgSession) Exchange(ctx context.Context, q database.QueryExecutor, projectID, handoffToken string, idempotencyKey *string, ttl time.Duration) (*domain.Session, error) {
	//TODO implement me
	panic("implement me")
}

func (a *pgSession) Get(ctx context.Context, q database.QueryExecutor, projectID, sessionID string) (*domain.Session, error) {
	//TODO implement me
	panic("implement me")
}

func (a *pgSession) List(ctx context.Context, q database.QueryExecutor, projectID string) ([]*domain.Session, error) {
	//TODO implement me
	panic("implement me")
}

func (a *pgSession) Delete(ctx context.Context, q database.QueryExecutor, projectID, sessionID string) error {
	//TODO implement me
	panic("implement me")
}

var _ domain.SessionRepository = (*pgSession)(nil)

// ── Spanner implementation ────────────────────────────────────────────────────

type spannerSession struct{}

func (a *spannerSession) Create(ctx context.Context, q database.QueryExecutor, session *domain.Session) error {
	//TODO implement me
	panic("implement me")
}

func (a *spannerSession) Exchange(ctx context.Context, q database.QueryExecutor, projectID, handoffToken string, idempotencyKey *string, ttl time.Duration) (*domain.Session, error) {
	//TODO implement me
	panic("implement me")
}

func (a *spannerSession) Get(ctx context.Context, q database.QueryExecutor, projectID, sessionID string) (*domain.Session, error) {
	//TODO implement me
	panic("implement me")
}

func (a *spannerSession) List(ctx context.Context, q database.QueryExecutor, projectID string) ([]*domain.Session, error) {
	//TODO implement me
	panic("implement me")
}

func (a *spannerSession) Delete(ctx context.Context, q database.QueryExecutor, projectID, sessionID string) error {
	//TODO implement me
	panic("implement me")
}

var _ domain.SessionRepository = (*spannerSession)(nil)
