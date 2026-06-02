package service

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/ianlancetaylor/jsonschema"
	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/maputil"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// ---- Input types -------------------------------------------------------------

type CreateUserInput struct {
	ProjectID string
	TeamID    *string
	User      map[string]any
}

type SetPasswordInput struct {
	ProjectID                string
	UserID                   string
	Password                 string
	IsPasswordChangeRequired bool
}

type GetUserInput struct {
	ProjectID string
	TeamID    *string
	UserID    string
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

func (s *UserService) CreateUser(ctx context.Context, input CreateUserInput) (_ map[string]any, err error) {
	// FETCH SCHEMA

	schemaURL, ok := maputil.Get[string](input.User, "$schema")
	if !ok {
		return nil, domain.ErrUserInvalid().
			WithDetails("No $schema provided for the user. A schema must be provided when creating a new user. Against this schema, the user will be validated")
	}

	schemaEntity, err := s.schemaRepo.GetByID(ctx, s.pool, input.ProjectID, schemaURL)
	if err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return nil, domain.ErrUserInvalid().WithDetails("$schema is not known to the system. First create a schema, then create users.")
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to get schema from database")
	}

	// VALIDATE USER

	var schema jsonschema.Schema
	err = json.Unmarshal(schemaEntity.Schema, &schema)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to unmarshal json schema")
	}

	err = schema.Validate(input.User)
	if err != nil {
		return nil, domain.ErrUserInvalid().
			WithParent(err).
			WithMessage("user is not valid according to schema")
	}

	// PREPARE DOMAIN USER

	var schemaMap map[string]any
	err = json.Unmarshal(schemaEntity.Schema, &schemaMap)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to unmarshal schema map")
	}

	createUser, err := domain.NewCreateUser(input.ProjectID, input.TeamID, schemaURL, input.User, schemaMap)
	if err != nil {
		return nil, err
	}

	// SAVE USER

	err = s.userRepo.Create(ctx, s.pool, createUser)
	if err != nil {
		if _, ok := errors.AsType[*database.UniqueError](err); ok {
			return nil, domain.ErrUserAlreadyExists().WithParent(err)
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to create user in the database")
	}

	input.User["id"] = createUser.ID
	return input.User, nil
}

func (s *UserService) GetUserByID(ctx context.Context, input GetUserInput) (map[string]any, error) {
	flatUser, err := s.userRepo.GetByID(ctx, s.pool, input.ProjectID, input.TeamID, input.UserID)
	if err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return nil, domain.ErrUserNotFound()
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to get user from database")
	}

	user, err := domain.BuildAttributeTree(flatUser.Attributes)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to parse user attributes")
	}

	user["id"] = flatUser.ID
	return user, nil
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

	pwd, err := s.passwordRepo.GetByUserID(ctx, tx, input.ProjectID, input.UserID)

	if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
		err = s.createPassword(ctx, tx, input.ProjectID, input.UserID, hash, input.IsPasswordChangeRequired)
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
	projectID string, userID string, pwdHash string, isPasswordChangeRequired bool) error {
	err := s.passwordRepo.Create(ctx, client, &domain.CreateUserPassword{
		ProjectID:      projectID,
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
