package domain

import (
	"context"
	"time"

	"github.com/zitadel/nextgen/internal/storage/database"
)

type AuthMethod int

const (
	AuthMethodPassword AuthMethod = iota
	AuthMethodPasskey
	AuthMethodTOTP
	AuthMethodRecoveryCodes
)

const (
	PrefixUser ResourcePrefix = "user"
)

func ErrUserInvalid() Error {
	return newError(PrefixUser.ErrorCodePrefix("invalid"), "user invalid", nil, nil)
}

func ErrUserNotFound() Error {
	return newError(PrefixUser.ErrorCodePrefix("not_found"), "user not found", nil, nil)
}

func ErrUserAlreadyExists() Error {
	return newError(PrefixUser.ErrorCodePrefix("already_exists"), "a user already exists with the given unique attributes", nil, nil)
}

// User is a hydrated user projection (header + optional EAV joins).
type User struct {
	ProjectID string
	SchemaURL string
	ID        string
	TeamID    *string
	CreatedAt time.Time
	UpdatedAt time.Time

	// The following fields are only populated when corresponding query options are set.
	Attributes           []Attribute
	AvailableAuthMethods []AuthMethod
}

type CreateUser struct {
	ProjectID  string
	SchemaURL  string
	ID         string
	TeamID     *string
	Attributes []*CreateAttribute
}

func NewCreateUser(projectID string, teamID *string, schemaURL string, attributes map[string]any, schema map[string]any) (*CreateUser, error) {
	id, err := newID(PrefixUser)
	if err != nil {
		return nil, ErrInternal(err).WithMessage("failed to create user id")
	}

	attrs, err := FlattenMapToCreateAttributes(attributes, schema, "")
	if err != nil {
		return nil, ErrInternal(err).WithMessage("failed to flatten user attributes")
	}

	return &CreateUser{
		ProjectID:  projectID,
		TeamID:     teamID,
		ID:         id,
		SchemaURL:  schemaURL,
		Attributes: attrs,
	}, nil
}

type UserRepository interface {
	Repository

	userConditions
	userChanges
	userJoins

	GetByID(ctx context.Context, client database.QueryExecutor, projectID string, teamID *string, userID string) (*User, error)
	Get(ctx context.Context, client database.QueryExecutor, opts ...database.QueryOption) (*User, error)
	List(ctx context.Context, client database.QueryExecutor, opts ...database.QueryOption) ([]*User, error)
	Create(ctx context.Context, client database.QueryExecutor, user *CreateUser) error
	Delete(ctx context.Context, client database.QueryExecutor, condition database.Condition) error
}

type userConditions interface {
	ProjectIDCondition(projectID string) database.Condition
	IDCondition(id string) database.Condition
	PrimaryKeyCondition(projectID, id string) database.Condition
	TeamIDCondition(teamID string) database.Condition
	AttributesCondition(attributes []Attribute) database.Condition
}

type userChanges interface {
	SetTeam(teamID *string) database.Change
	SetAttribute(a CreateAttribute) database.Change
	DeleteAttribute(key string) database.Condition
}

type userJoins interface {
	WithAttributes(filterKeys ...string) database.QueryOption
	WithAvailableAuthMethods() database.QueryOption
}
