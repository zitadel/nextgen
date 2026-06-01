package service

import (
	"context"
	"errors"

	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// ---- Input types -------------------------------------------------------------

type SetPasswordInput struct {
	ProjectID string
	TeamID    *string
	UserID    string
	Password  string
}

// ---- Implementation -------------------------------------------------------------

type UserService struct {
	pool         database.Pool
	userRepo     domain.UserRepository
	passwordRepo domain.UserPasswordRepository
	schemaRepo   domain.JSONSchemaRepository
	hasher       crypto.Hasher
}

func NewUserService(
	pool database.Pool,
	userRepo domain.UserRepository,
	passwordRepo domain.UserPasswordRepository,
	schemaRepo domain.JSONSchemaRepository,
	hasher crypto.Hasher,
) *UserService {
	return &UserService{
		pool:         pool,
		userRepo:     userRepo,
		passwordRepo: passwordRepo,
		schemaRepo:   schemaRepo,
		hasher:       hasher,
	}
}

func (s *UserService) SetPassword(ctx context.Context, input SetPasswordInput) error {
	hash, err := domain.HashPassword(input.Password, s.hasher)
	if err != nil {
		return err
	}

	err = s.passwordRepo.Upsert(ctx, s.pool, input.ProjectID, input.TeamID, input.UserID, hash)
	if err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return domain.ErrUserNotFound()
		}
		return domain.ErrInternal(err).WithMessage("failed to set password")
	}

	return nil
}
