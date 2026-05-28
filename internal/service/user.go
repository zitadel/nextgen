package service

import (
	"context"
	"errors"
	"time"

	"github.com/ogen-go/ogen/json"
	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// ---- Inputs -------------------------------------------------------------

type GetMyUserInput struct {
	SessionToken string
}

// ---- Implementation -------------------------------------------------------------

type UserService struct {
	pool      database.Pool
	userRepo  domain.UserRepository
	decrypter crypto.Decrypter
}

func NewUserService(
	pool database.Pool,
	userRepo domain.UserRepository,
	sealer crypto.Decrypter,
) *UserService {
	return &UserService{
		pool:      pool,
		userRepo:  userRepo,
		decrypter: sealer,
	}
}

func (s *UserService) GetMyUser(ctx context.Context, input GetMyUserInput) ([]byte, error) {
	sessionToken, err := domain.DecryptSessionTokenString(input.SessionToken, s.decrypter)
	if err != nil {
		return nil, domain.ErrSessionTokenInvalid()
	}
	if sessionToken.ExpiresAt.After(time.Now()) {
		return nil, domain.ErrSessionTokenInvalid()
	}
	if sessionToken.UserID == nil {
		return nil, domain.ErrUserNotFound()
	}

	user, err := s.userRepo.GetByID(ctx, s.pool, sessionToken.ProjectID, *sessionToken.UserID)
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
