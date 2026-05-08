package repository

import (
	"context"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

type Session struct{}

func (a *Session) GetByID(ctx context.Context, q database.QueryExecutor, projectID, sessionID string) (*domain.Session, error) {
	// TODO: actual implementation to fetch session from database
	if sessionID == "sess_aa" {
		return nil, domain.ErrSessionNotFound()
	}
	return &domain.Session{
		ID:        sessionID,
		ProjectID: projectID,
		UserID:    new("user_123"),
		Factors: []domain.AuthCheck{
			domain.NewAuthFactorUser("user_123", time.Now().Add(-1*time.Hour)),
		},
	}, nil
}
