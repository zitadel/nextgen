package repository

import (
	"context"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

type User struct{}

func (u *User) Get(ctx context.Context, q database.QueryExecutor, projectID, username string) (*domain.User, error) {
	// TODO: actual implementation to fetch user from database
	return &domain.User{
		ProjectID: projectID,
		ID:        "user_" + username,
	}, nil
}
