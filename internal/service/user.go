package service

import (
	"context"
	"errors"

	"github.com/ogen-go/ogen/json"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// ---- Inputs -------------------------------------------------------------

type GetUserInput struct {
	ProjectID string
	UserID    string
}

// ---- Implementation -------------------------------------------------------------

type UserService struct {
	pool     database.Pool
	userRepo domain.UserRepository
}

func NewUserService(
	pool database.Pool,
	userRepo domain.UserRepository,
) *UserService {
	return &UserService{
		pool,
		userRepo,
	}
}

func (s *UserService) GetUser(ctx context.Context, input GetUserInput) ([]byte, error) {
	user, err := s.userRepo.GetById(ctx, s.pool, input.ProjectID, input.UserID)
	if err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return nil, domain.ErrUserNotFound()
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to get user from database")
	}

	userbs, err := json.Marshal(user)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to serialize user")
	}

	return userbs, nil
}
