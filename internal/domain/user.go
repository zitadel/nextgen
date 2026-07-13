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
	TeamID    *string
	CreatedAt time.Time
	UpdatedAt time.Time

	// The following fields are only populated when corresponding query options are set.
	Attributes           []Attribute
	AvailableAuthMethods []AuthMethod
}

// IdentityAttributeKeys are the conventional user-schema property names the
// platform reads to render a user's identity (e.g. `name` and `email` on
// `GET /sessions/me`). Schemas stay free-form: a schema that names these
// properties differently simply yields no display name or email, and callers
// fall back to the user ID.
var IdentityAttributeKeys = []string{"email", "family_name", "given_name", "name"}

// StringAttribute returns the value of the attribute with the given key when
// it is a non-empty string, and "" otherwise (absent key or non-string value).
func (u *User) StringAttribute(key string) string {
	for _, a := range u.Attributes {
		if a.Key != key {
			continue
		}
		value, _ := a.Value.(string)
		return value
	}
	return ""
}

// DisplayName resolves the user's human-readable name from the conventional
// identity attributes: `name` when present, otherwise `given_name` and
// `family_name` joined. Returns "" when the loaded attributes carry neither.
func (u *User) DisplayName() string {
	if name := u.StringAttribute("name"); name != "" {
		return name
	}
	name := u.StringAttribute("given_name")
	if familyName := u.StringAttribute("family_name"); familyName != "" {
		if name != "" {
			name += " "
		}
		name += familyName
	}
	return name
}

// Email returns the conventional `email` identity attribute, or "" when the
// loaded attributes do not carry one.
func (u *User) Email() string {
	return u.StringAttribute("email")
}

type CreateUser struct {
	ProjectID  string
	SchemaURL  string
	ID         string
	TeamID     *string
	Attributes []*CreateAttribute
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
		ProjectID:  projectID,
		TeamID:     teamID,
		ID:         id,
		SchemaURL:  schemaURL,
		Attributes: attrs,
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
