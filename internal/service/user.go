package service

import (
	"context"
	"encoding/json"

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

func (s *UserService) CreateUser(ctx context.Context, input CreateUserInput) (*domain.User, error) {
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
		return nil, domain.ErrRequestInvalid().
			WithMessage("no $schema provided for the user").
			WithDetails("A schema must be provided when creating a new user. Against this schema, the user will be validated")
	}
	strSchemaURL, ok := schemaURL.(string)
	if !ok {
		return nil, domain.ErrRequestInvalid().WithMessage("the schema must be a string")
	}

	schemaEntity, err := s.schemaRepo.GetByID(ctx, tx, input.ProjectID, strSchemaURL)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to get schema")
	}

	// VALIDATE USER

	var schema jsonschema.Schema
	err = json.Unmarshal(schemaEntity.Schema, &schema)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to unmarshal json schema")
	}

	err = schema.Validate(input.User)
	if err != nil {
		return nil, domain.ErrRequestInvalid().
			WithParent(err).
			WithMessage("user does is not valid according to schema")
	}

	// PREPARE DOMAIN USER

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
		// TODO(wim): add proper error handling
		return nil, err
	}

	if err = tx.Commit(ctx); err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to commit transaction")
	}

	// FETCH CREATED ENTITY
	panic("IMPLEMENT")
}

func (s *UserService) UpdateUser(ctx context.Context, input UpdateUserInput) (*domain.User, error) {
	panic("IMPLEMENT")
}

func (s *UserService) GetUser(ctx context.Context, projectID string, userID string) (*domain.User, error) {
	panic("IMPLEMENT")
}

func (s *UserService) ListUsers(ctx context.Context, input ListUsersInput) ([]domain.User, error) {
	panic("IMPLEMENT")
}
