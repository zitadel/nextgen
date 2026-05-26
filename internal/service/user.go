package service

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/ianlancetaylor/jsonschema"
	"github.com/jackc/pgx/v5"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// ---- Input types -------------------------------------------------------------

type CreateUserInput struct {
	ProjectID string
	TeamID    *string
	User      map[string]any
}

type UpdateUserInput struct {
	ProjectID string
	TeamID    *string
	UserID    string
	User      map[string]any
}

type ListUsersInput struct {
	ProjectID string
	TeamID    string
	PageToken string
	Limit     int
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
		pool,
		userRepo,
		schemaRepo,
	}
}

func (s *UserService) CreateUser(ctx context.Context, input CreateUserInput) (*domain.User, error) {
	tx, txErr := s.pool.Begin(ctx, nil)
	if txErr != nil {
		return nil, domain.ErrInternal(txErr).WithMessage("failed to create transaction")
	}
	defer func() {
		if txErr != nil {
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
		if errors.Is(err, pgx.ErrNoRows) {
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

	// TODO: let db generate database
	id, err := domain.NewID(domain.PrefixUser)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to generate id")
	}

	var schemaMap map[string]any
	err = json.Unmarshal(schemaEntity.Schema, &schemaMap)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to unmarshal schema map")
	}

	attrs, err := domain.FlattenMapToCreateAttributes(input.User, schemaMap, "")
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to flatten user")
	}

	// SAVE USER

	err = s.userRepo.Create(ctx, tx, &domain.CreateUser{
		ProjectID:  input.ProjectID,
		TeamID:     input.TeamID,
		SchemaURL:  strSchemaURL,
		ID:         id,
		Attributes: attrs,
	})
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to create user in the database")
	}

	if err = tx.Commit(ctx); err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to commit transaction")
	}

	// FETCH CREATED ENTITY
	user, err := s.userRepo.GetByID(ctx, s.pool, input.ProjectID, input.TeamID, id)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to find user which was just created")
	}
	return user, nil
}

func (s *UserService) PatchUser(ctx context.Context, input UpdateUserInput) (*domain.User, error) {
	panic("IMPLEMENT")
}

func (s *UserService) GetUser(ctx context.Context, projectID string, teamID *string, userID string) (*domain.User, error) {
	user, err := s.userRepo.GetByID(ctx, s.pool, projectID, teamID, userID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrUserNotFound()
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to get user from database")
	}
	return user, nil
}

func (s *UserService) ListUsers(ctx context.Context, input ListUsersInput) ([]*domain.User, error) {
	panic("IMPLEMENT")
}
