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
	ProjectID                string
	TeamID                   *string
	UserID                   string
	Password                 string
	IsPasswordChangeRequired bool
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

	tx, err := s.pool.Begin(ctx, nil)
	if err != nil {
		return domain.ErrInternal(err).WithMessage("failed to create transaction")
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback(ctx)
		}
	}()

	pwd, err := s.passwordRepo.GetByUserID(ctx, tx, input.ProjectID, input.TeamID, input.UserID)

	if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
		err = s.createPassword(ctx, tx, input.ProjectID, input.TeamID, input.UserID, hash, input.IsPasswordChangeRequired)
	} else if err != nil {
		err = domain.ErrInternal(err).WithMessage("failed to get current password from database")
	} else {
		err = s.updatePassword(ctx, tx, pwd, hash, input.IsPasswordChangeRequired)
	}

	if err != nil {
		return err
	}

	err = tx.Commit(ctx)
	if err != nil {
		return domain.ErrInternal(err).WithMessage("failed to commit transaction while setting password")
	}
	return nil
}

func (s *UserService) createPassword(ctx context.Context, client database.QueryExecutor,
	projectID string, teamID *string, userID string, pwdHash string, isPasswordChangeRequired bool) error {
	err := s.passwordRepo.Create(ctx, client, &domain.CreateUserPassword{
		ProjectID:      projectID,
		TeamID:         teamID,
		UserID:         userID,
		EncodedHash:    pwdHash,
		ChangeRequired: isPasswordChangeRequired,
		VerificationID: nil, // TODO what should I do with this?
	})

	if err != nil {
		if _, ok := errors.AsType[*database.IntegrityViolationError](err); ok {
			return domain.ErrUserNotFound()
		}
		return domain.ErrInternal(err).WithMessage("failed to set initial password")
	}

	return nil
}

func (s *UserService) updatePassword(ctx context.Context, client database.QueryExecutor,
	pwd *domain.UserPassword, pwdHash string, isPasswordChangeRequired bool) error {
	pwd.Update(pwdHash)
	if isPasswordChangeRequired {
		pwd.RequireChange()
	}

	err := s.passwordRepo.Update(ctx, client, pwd)
	if err != nil {
		return domain.ErrInternal(err).WithMessage("failed to update password in database")
	}

	return nil
}
