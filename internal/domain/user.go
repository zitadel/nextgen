package domain

import (
	"context"
	"encoding/json"
	"time"

	"github.com/ianlancetaylor/jsonschema"
	"github.com/zitadel/nextgen/internal/maputil"
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
	// LifecycleOwnerTeamID is set when a team owns this user's lifecycle; nil means self-owned.
	LifecycleOwnerTeamID *string
	Status               UserStatus
	CreatedAt            time.Time
	UpdatedAt            time.Time

	// The following fields are only populated when corresponding query options are set.
	Attributes           []Attribute
	AvailableAuthMethods []AuthMethod
}

// IsSelfOwned reports whether the user owns their own lifecycle.
func (u *User) IsSelfOwned() bool { return u.LifecycleOwnerTeamID == nil }

// IsTeamOwned reports whether a team owns this user's lifecycle.
func (u *User) IsTeamOwned() bool { return u.LifecycleOwnerTeamID != nil }

// OwningTeamID returns the lifecycle owner team id when team-owned.
func (u *User) OwningTeamID() (string, bool) {
	if u.LifecycleOwnerTeamID == nil {
		return "", false
	}
	return *u.LifecycleOwnerTeamID, true
}

type CreateUser struct {
	ProjectID string
	SchemaURL string
	ID        string
	// LifecycleOwnerTeamID set => team-owned; nil => self-owned (default).
	LifecycleOwnerTeamID *string
	// ParticipationTeamID seeds an active team_memberships row and team-scoped EAV uniqueness scope.
	ParticipationTeamID *string
	Attributes          []*CreateAttribute
}

// AttributeTeamScope returns the team id used for team-scoped unique attributes on create.
func (c *CreateUser) AttributeTeamScope() string {
	if c.ParticipationTeamID != nil && *c.ParticipationTeamID != "" {
		return *c.ParticipationTeamID
	}
	if c.LifecycleOwnerTeamID != nil && *c.LifecycleOwnerTeamID != "" {
		return *c.LifecycleOwnerTeamID
	}
	return ""
}

func NewCreateUser(projectID string, participationTeamID *string, schemabs []byte, muser map[string]any) (*CreateUser, error) {
	schemaURL, err := SchemaFromUserMap(muser)
	if err != nil {
		return nil, err
	}

	var jschema jsonschema.Schema
	err = json.Unmarshal(schemabs, &jschema)
	if err != nil {
		return nil, ErrInternal(err).WithMessage("failed to unmarshal json schema")
	}

	err = jschema.Validate(muser)
	if err != nil {
		return nil, ErrUserInvalid().WithParent(err).WithMessage("user is not valid according to schema")
	}

	var mschema map[string]any
	err = json.Unmarshal(schemabs, &mschema)
	if err != nil {
		return nil, ErrInternal(err).WithMessage("failed to unmarshal schema map")
	}

	id, err := newID(PrefixUser)
	if err != nil {
		return nil, ErrInternal(err).WithMessage("failed to create user id")
	}

	attrs, err := FlattenMapToCreateAttributes(muser, mschema, "")
	if err != nil {
		return nil, ErrInternal(err).WithMessage("failed to flatten user attributes")
	}

	return &CreateUser{
		ProjectID:           projectID,
		ParticipationTeamID: participationTeamID,
		ID:                  id,
		SchemaURL:           schemaURL,
		Attributes:          attrs,
	}, nil
}

func SchemaFromUserMap(user map[string]any) (string, error) {
	schemaURL, ok := maputil.Get[string](user, "$schema")
	if !ok {
		return "", ErrUserInvalid().
			WithDetails("No $schema provided for the user. A schema must be provided when creating a new user. Against this schema, the user will be validated")
	}
	return schemaURL, nil
}

type UserRepository interface {
	Repository

	userConditions
	userChanges
	userJoins

	GetByID(ctx context.Context, client database.QueryExecutor, projectID string, membershipTeamID *string, userID string) (*User, error)
	Get(ctx context.Context, client database.QueryExecutor, opts ...database.QueryOption) (*User, error)
	List(ctx context.Context, client database.QueryExecutor, opts ...database.QueryOption) ([]*User, error)
	Create(ctx context.Context, client database.QueryExecutor, user *CreateUser) error
	Deactivate(ctx context.Context, client database.QueryExecutor, projectID, userID string) error
	Delete(ctx context.Context, client database.QueryExecutor, condition database.Condition) error
}

type userConditions interface {
	ProjectIDCondition(projectID string) database.Condition
	IDCondition(id string) database.Condition
	PrimaryKeyCondition(projectID, id string) database.Condition
	LifecycleOwnerTeamIDCondition(teamID string) database.Condition
	MembershipTeamCondition(teamID string) database.Condition
	AttributesCondition(attributes []Attribute) database.Condition
}

type userChanges interface {
	SetLifecycleOwnerTeamID(teamID *string) database.Change
	SetStatus(status UserStatus) database.Change
	SetAttribute(a CreateAttribute) database.Change
	DeleteAttribute(key string) database.Condition
}

type userJoins interface {
	WithAttributes(filterKeys ...string) database.QueryOption
	WithAvailableAuthMethods() database.QueryOption
}
