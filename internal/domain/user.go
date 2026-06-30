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

// UserStatus is the lifecycle state of a user identity within a project.
type UserStatus string

const (
	UserStatusActive       UserStatus = "active"
	UserStatusSuspended    UserStatus = "suspended"
	UserStatusDeactivated  UserStatus = "deactivated"
	UserStatusPendingPurge UserStatus = "pending_purge"
)

func (s UserStatus) String() string { return string(s) }

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
	// LifecycleOwnerTeamID decides who manages this user's identity lifecycle (ADR 024).
	// nil => self-owned: the user survives team deletion and owns their own deprovisioning.
	// set => team-owned: deleting/deactivating that team can deactivate this user per policy.
	LifecycleOwnerTeamID *string
	// InitialMembershipTeamID is optional roster context at create time — not lifecycle ownership.
	// When set, Create also inserts an active team_memberships row for this team and uses it as the
	// team-scoped EAV uniqueness scope for attributes. A self-owned signup user can still set this
	// to their default workspace team; an enterprise provisioned user may set both fields to the
	// same tenant team, but lifecycle ownership and roster membership remain separate concerns.
	InitialMembershipTeamID *string
	Attributes              []*CreateAttribute
}

// AttributeTeamScope returns the team id used for team-scoped unique attributes on create.
func (c *CreateUser) AttributeTeamScope() string {
	if c.InitialMembershipTeamID != nil && *c.InitialMembershipTeamID != "" {
		return *c.InitialMembershipTeamID
	}
	if c.LifecycleOwnerTeamID != nil && *c.LifecycleOwnerTeamID != "" {
		return *c.LifecycleOwnerTeamID
	}
	return ""
}

// NewCreateUser builds a [CreateUser] from a schema-validated user map.
// id passes through when non-empty; otherwise a fresh one is minted.
func NewCreateUser(projectID string, teamID *string, id string, schemabs []byte, muser map[string]any) (*CreateUser, error) {
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

	if id == "" {
		id, err = newID(PrefixUser)
		if err != nil {
			return nil, ErrInternal(err).WithMessage("failed to create user id")
		}
	}

	attrs, err := FlattenMapToCreateAttributes(muser, mschema, "")
	if err != nil {
		return nil, ErrInternal(err).WithMessage("failed to flatten user attributes")
	}

	return &CreateUser{
		ProjectID:               projectID,
		InitialMembershipTeamID: teamID,
		ID:                      id,
		SchemaURL:               schemaURL,
		Attributes:              attrs,
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

//go:generate go tool mockgen -typed -package domainmock -destination ./mock/user.mock.go . UserRepository

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
