package repository

import (
	"context"

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

var _ domain.SessionRepository = (*pgSession)(nil)

func (a *pgSession) GetByID(ctx context.Context, client database.QueryExecutor, projectID, sessionID string) (*domain.Session, error) {
	panic("not implemented")
}

// ── Spanner implementation ────────────────────────────────────────────────────

type spannerSession struct{}

var _ domain.SessionRepository = (*spannerSession)(nil)

func (a *spannerSession) GetByID(ctx context.Context, client database.QueryExecutor, projectID, sessionID string) (*domain.Session, error) {
	panic("not implemented")
}
