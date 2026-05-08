package repository

import (
	"context"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

type UserPasskeyRepository struct{}

func (u *UserPasskeyRepository) Get(ctx context.Context, q database.QueryExecutor, projectID, userID, passkeyID string) (*domain.UserPasskey, error) {
	//TODO implement me
	panic("implement me")
}

func (u *UserPasskeyRepository) List(ctx context.Context, q database.QueryExecutor, projectID, userID string) ([]*domain.UserPasskey, error) {
	//TODO implement me
	panic("implement me")
}
