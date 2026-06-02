package service

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/ianlancetaylor/jsonschema"
	"github.com/ogen-go/ogen/json"
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

type GetUserInput struct {
	ProjectID string
	TeamID    *string
	UserID    string
}

type GetMyUserInput struct {
	SessionToken string
}

// ---- Implementation -------------------------------------------------------------

type UserService struct {
	pool      database.Pool
	userRepo  domain.UserRepository
	decrypter crypto.Decrypter
	schemaRepo domain.JSONSchemaRepository
}

func NewUserService(
	pool database.Pool,
	userRepo domain.UserRepository,
	sealer crypto.Decrypter,
	schemaRepo domain.JSONSchemaRepository,
) *UserService {
	return &UserService{
		pool:      pool,
		userRepo:  userRepo,
		decrypter: sealer,
		schemaRepo: schemaRepo,
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
