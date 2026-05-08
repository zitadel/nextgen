package repository

import (
	"context"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

type UserPasswordRepository struct{}

func (u *UserPasswordRepository) Get(ctx context.Context, q database.QueryExecutor, projectID, userID string) (*domain.UserPassword, error) {
	return &domain.UserPassword{}, nil
}
