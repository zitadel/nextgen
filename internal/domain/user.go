package domain

import (
	"encoding/json"
	"time"

	"github.com/ianlancetaylor/jsonschema"
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

func ErrUserPermissionDenied() Error {
	return newError(PrefixUser.ErrorCodePrefix("permission_denied"), "the user management API requires the project secret", nil, nil)
}

// User is a hydrated user projection (header + optional EAV joins).
type User struct {
	ProjectID string
	SchemaURL string
	ID        string
	// LifecycleOwnerTeamID is set when a team owns this user's lifecycle; nil means self-owned.
	LifecycleOwnerTeamID *string
	Metadata             UserMetadata

	// Attributes are populated by user read statements.
	Attributes Attributes
}

type UserMetadata struct {
	Status    UserStatus
	CreatedAt time.Time
	UpdatedAt time.Time
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

// IdentityAttributeKeys are the conventional user-schema property names the
// platform reads to render a user's identity (e.g. `name` and `email` on
// `GET /sessions/me`). The shipped presets spell the name parts camelCase
// (`givenName`/`familyName` — see packages/config/defaults/*.json); the
// snake_case spellings stay accepted for schemas authored that way. Schemas
// remain free-form: one that names these properties differently simply
// yields no display name or email, and callers fall back to the user ID.
var IdentityAttributeKeys = []string{
	"email",
	"familyName",
	"family_name",
	"givenName",
	"given_name",
	"name",
}

// StringAttribute returns the value of the attribute with the given key when
// it is a non-empty string, and "" otherwise (absent key or non-string value).
func (u *User) StringAttribute(key AttributeKey) string {
	value, _ := u.Attributes.Get(key)
	s, _ := value.(string)
	return s
}

// DisplayName resolves the user's human-readable name from the conventional
// identity attributes: `name` when present, otherwise the given and family
// name parts joined — camelCase spelling first (the shipped presets'
// convention), snake_case as fallback. Returns "" when the loaded
// attributes carry none of them.
func (u *User) DisplayName() string {
	if name := u.StringAttribute("name"); name != "" {
		return name
	}
	name := u.firstStringAttribute("givenName", "given_name")
	if familyName := u.firstStringAttribute("familyName", "family_name"); familyName != "" {
		if name != "" {
			name += " "
		}
		name += familyName
	}
	return name
}

// firstStringAttribute returns the first key's non-empty string value.
func (u *User) firstStringAttribute(keys ...AttributeKey) string {
	for _, key := range keys {
		if value := u.StringAttribute(key); value != "" {
			return value
		}
	}
	return ""
}

// Email returns the conventional `email` identity attribute, or "" when the
// loaded attributes do not carry one.
func (u *User) Email() string {
	return u.StringAttribute("email")
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
	Attributes              CreateAttributes
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

// NewCreateUser builds a [CreateUser] from the schema-defined attributes.
// Empty id is filled by the dialect on create; non-empty id is for ceremony only.
//
// attrs is the instance the schema validates: envelope fields (id, schema,
// metadata) are not part of it, so a schema may declare properties of those
// names and closed-world keywords such as additionalProperties: false hold.
func NewCreateUser(projectID string, teamID *string, id, schemaURL string, schemabs []byte, attrs map[string]any) (*CreateUser, error) {
	if schemaURL == "" {
		return nil, ErrUserInvalid().
			WithMessage("No schema provided. A user must name the schema its attributes are validated against.")
	}

	var jschema jsonschema.Schema
	err := json.Unmarshal(schemabs, &jschema)
	if err != nil {
		return nil, ErrInternal(err).WithMessage("failed to unmarshal json schema")
	}

	err = jschema.Validate(attrs)
	if err != nil {
		return nil, ErrUserInvalid().WithParent(err).WithMessage("user is not valid according to schema")
	}

	var mschema map[string]any
	err = json.Unmarshal(schemabs, &mschema)
	if err != nil {
		return nil, ErrInternal(err).WithMessage("failed to unmarshal schema map")
	}

	createAttrs, err := CreateAttributesFromMap(attrs, mschema)
	if err != nil {
		return nil, ErrInternal(err).WithMessage("failed to flatten user attributes")
	}

	return &CreateUser{
		ProjectID:               projectID,
		InitialMembershipTeamID: teamID,
		ID:                      id,
		SchemaURL:               schemaURL,
		Attributes:              createAttrs,
	}, nil
}

// UserField enumerates the fields of User which can be used for filtering and
// ordering in list operations.
type UserField uint8

const (
	UserFieldUnspecified UserField = iota
	UserFieldProjectID
	UserFieldID
	UserFieldSchemaURL
	UserFieldLifecycleOwnerTeamID
	UserFieldStatus
	UserFieldCreatedAt
	UserFieldUpdatedAt
)
