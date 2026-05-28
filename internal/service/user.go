package service

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/ianlancetaylor/jsonschema"
	"github.com/zitadel/nextgen/internal/domain"
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

// ---- Implementation -------------------------------------------------------------

type UserService struct {
	pool       database.Pool
	userRepo   domain.UserRepository
	schemaRepo domain.JSONSchemaRepository
}

func NewUserService(
	pool database.Pool,
	userRepo domain.UserRepository,
	schemaRepo domain.JSONSchemaRepository,
) *UserService {
	return &UserService{
		pool:       pool,
		userRepo:   userRepo,
		schemaRepo: schemaRepo,
	}
}

func (s *UserService) CreateUser(ctx context.Context, input CreateUserInput) (map[string]any, error) {
	tx, err := s.pool.Begin(ctx, nil)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to create transaction")
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback(ctx)
		}
	}()

	// FETCH SCHEMA

	schemaURL, ok := input.User["$schema"]
	if !ok {
		return nil, domain.ErrUserInvalid().
			WithDetails("No $schema provided for the user. A schema must be provided when creating a new user. Against this schema, the user will be validated")
	}
	strSchemaURL, ok := schemaURL.(string)
	if !ok {
		return nil, domain.ErrUserInvalid().WithDetails("$schema must be a string, preferably in a uri format")
	}

	schemaEntity, err := s.schemaRepo.GetByID(ctx, tx, input.ProjectID, strSchemaURL)
	if err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return nil, domain.ErrUserInvalid().WithDetails("$schema no known to the system. First create a schema, then create users.")
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
			WithMessage("user does is not valid according to schema")
	}

	// PREPARE DOMAIN USER

	var schemaMap map[string]any
	err = json.Unmarshal(schemaEntity.Schema, &schemaMap)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to unmarshal schema map")
	}

	createUser, err := domain.NewCreateUser(input.ProjectID, input.TeamID, strSchemaURL, input.User, schemaMap)
	if err != nil {
		return nil, err
	}

	// SAVE USER

	err = s.userRepo.Create(ctx, tx, createUser)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to create user in the database")
	}

	if err = tx.Commit(ctx); err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to commit transaction")
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
