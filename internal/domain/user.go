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

func ErrUserConflict() Error {
	return newError(PrefixUser.ErrorCodePrefix("conflict"), "the user was modified concurrently, retry the request", nil, nil)
}

func ErrUserPermissionDenied() Error {
	return newError(PrefixUser.ErrorCodePrefix("permission_denied"), "the user management API requires the project secret", nil, nil)
}

// UserSchemaUnknownDetails names the schema a create referenced that the
// project does not have.
type UserSchemaUnknownDetails struct {
	Schema string `json:"schema"`
}

// CreatedUserDetails names a user the server created, for the answer that
// cannot carry its representation.
type CreatedUserDetails struct {
	UserID string `json:"user_id"`
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

	// Ref is the derived identity of ADR 058 §3a, resolved live from the
	// schema's x-identifier/x-display designations. Populated by service
	// reads that resolve it; nil on plain statement-level reads.
	Ref *UserRef

	// Teams is the user's team memberships, populated only when the read asked
	// for it. Nil means it was not asked for; empty means the user has none.
	Teams []UserTeam
	// TeamsTruncated reports that the user is on more teams than the read's
	// cap carries. The whole list is served by ListUserTeams.
	TeamsTruncated bool

	// LifecycleOwnerTeam is the team named by LifecycleOwnerTeamID, populated
	// only when the read asked for it. Nil alone is ambiguous — a self-owned
	// user has no owner to load — so LifecycleOwnerTeamLoaded is what says the
	// read looked.
	LifecycleOwnerTeam *Team
	// LifecycleOwnerTeamLoaded reports that the read resolved the owner team.
	// It is the to-one counterpart of Teams being non-nil: it separates "not
	// asked for" from "asked for, and the user is self-owned".
	LifecycleOwnerTeamLoaded bool
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

// StringAttribute returns the value of the attribute with the given key when
// it is a non-empty string, and "" otherwise (absent key or non-string value).
func (u *User) StringAttribute(key AttributeKey) string {
	value, _ := u.Attributes.Get(key)
	s, _ := value.(string)
	return s
}

type CreateUser struct {
	ProjectID string
	SchemaURL string
	ID        string
	// LifecycleOwnerTeamID decides who manages this user's identity lifecycle (ADR 024).
	// nil => self-owned: the user survives team deletion and owns their own deprovisioning.
	// set => team-owned: deleting/deactivating that team can deactivate this user per policy.
	LifecycleOwnerTeamID *string
	// InitialMembershipTeamID is optional membership context at create time — not lifecycle ownership.
	// When set, Create also inserts an active team_memberships row for this team and uses it as the
	// team-scoped EAV uniqueness scope for attributes. A self-owned signup user can still set this
	// to their default workspace team; an enterprise provisioned user may set both fields to the
	// same tenant team, but lifecycle ownership and team membership remain separate concerns.
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

// CreateUserParams are the inputs to [NewCreateUser]. A struct rather than
// positional arguments because ID and SchemaURL are both strings: transposing
// them would type-check and write a schema url as the row's primary key.
type CreateUserParams struct {
	ProjectID string
	// TeamID is optional membership context, not lifecycle ownership — it
	// becomes [CreateUser.InitialMembershipTeamID].
	TeamID *string
	// ID is empty for a server-minted id; non-empty is for ceremony only.
	ID string
	// SchemaURL names the schema, and Schema is that schema's document.
	SchemaURL string
	Schema    []byte
	// Attributes is the instance the schema validates: envelope fields (id,
	// schema, metadata) are not part of it, so a schema may declare properties
	// of those names and closed-world keywords such as additionalProperties:
	// false hold.
	Attributes map[string]any
}

// NewCreateUser builds a [CreateUser] from the schema-defined attributes.
func NewCreateUser(params CreateUserParams) (*CreateUser, error) {
	if params.SchemaURL == "" {
		return nil, ErrUserInvalid().
			WithMessage("No schema provided. A user must name the schema its attributes are validated against.")
	}

	createAttrs, err := validateAndFlattenAttributes(params.Schema, params.Attributes,
		"No attributes provided. A user must carry at least one schema-defined property.")
	if err != nil {
		return nil, err
	}

	return &CreateUser{
		ProjectID:               params.ProjectID,
		InitialMembershipTeamID: params.TeamID,
		ID:                      params.ID,
		SchemaURL:               params.SchemaURL,
		Attributes:              createAttrs,
	}, nil
}

// PatchUser is the full post-merge state the patch statement writes — not a
// delta: the statement reconciles the stored rows to exactly this set.
type PatchUser struct {
	ProjectID string
	UserID    string
	// SchemaURL is the schema pointer after the patch (unchanged unless the
	// patch moved it, per ADR 009 §4).
	SchemaURL string
	// ExpectedUpdatedAt is the updated_at the merge was computed against. The
	// statement writes nothing when the row has moved past it, so a lost race
	// re-merges against fresh state instead of clobbering the interleaved
	// write.
	ExpectedUpdatedAt time.Time
	// Attributes is the complete desired attribute set after the merge.
	Attributes CreateAttributes
	// AttributeTeamScope is the team_id recorded on rewritten attribute rows,
	// and the scope fallback RegistryTeamScopes was computed with.
	AttributeTeamScope string
	// RegistryTeamScopes is the resolved team scope of each registry row,
	// index-aligned with Attributes: existing claims keep their stored scope,
	// new team-unique claims fall back to AttributeTeamScope (see
	// [CreateAttributes.RegistryTeamScopes]). Resolved here once so the
	// dialects stay pure writers.
	RegistryTeamScopes []string
}

// PatchUserParams are the inputs to [NewPatchUser].
type PatchUserParams struct {
	// Current is the stored user the patch merges into.
	Current *User
	// SchemaURL names the schema the merged document must satisfy: the
	// current pointer, or the new one when the patch moves it. Schema is that
	// schema's document.
	SchemaURL string
	Schema    []byte
	// AttributesPatch is merged into the current attributes per
	// [MergeAttributesPatch]; nil values delete.
	AttributesPatch map[string]any
	// StoredRegistryScopes is the stored registry team scope per key (from
	// [service.UserStatements].GetUserUniqueAttributeScopes), so existing
	// claims keep the scope create gave them. Reading it outside the write
	// transaction is safe: every registry mutation moves the user's
	// updated_at, so the patch statement's guard catches interleaved changes
	// and the caller re-merges from a fresh read.
	StoredRegistryScopes map[AttributeKey]string
}

// NewPatchUser merges the patch into the user's current attributes and
// validates the merged document against the target schema, mirroring
// [NewCreateUser] for the update path.
func NewPatchUser(params PatchUserParams) (*PatchUser, error) {
	if params.SchemaURL == "" {
		return nil, ErrUserInvalid().
			WithMessage("No schema provided. A user must name the schema its attributes are validated against.")
	}

	current, err := params.Current.Attributes.ToMap()
	if err != nil {
		return nil, ErrInternal(err).WithMessage("failed to expand stored user attributes")
	}
	merged := MergeAttributesPatch(current, params.AttributesPatch)

	patchAttrs, err := validateAndFlattenAttributes(params.Schema, merged,
		"No attributes left. A user must carry at least one schema-defined property.")
	if err != nil {
		return nil, err
	}

	// Fallback scope for team-unique claims not yet in the registry:
	// lifecycle owner team, else "" (project-wide). Existing claims keep
	// their stored team scope, because create may have scoped them to an
	// initial membership team this patch knows nothing about (see
	// [CreateUser.AttributeTeamScope]).
	teamScope := ""
	if params.Current.LifecycleOwnerTeamID != nil {
		teamScope = *params.Current.LifecycleOwnerTeamID
	}

	return &PatchUser{
		ProjectID:          params.Current.ProjectID,
		UserID:             params.Current.ID,
		SchemaURL:          params.SchemaURL,
		ExpectedUpdatedAt:  params.Current.Metadata.UpdatedAt,
		Attributes:         patchAttrs,
		AttributeTeamScope: teamScope,
		RegistryTeamScopes: patchAttrs.RegistryTeamScopes(params.StoredRegistryScopes, teamScope),
	}, nil
}

// validateAndFlattenAttributes validates the document against the schema and
// flattens it into attribute rows. A document that flattens to no rows is
// refused with emptyMessage: a user is stored as its attribute rows, so with
// none there is nothing to write. The dialects refuse it too, so catching it
// here answers 400 instead of 500.
func validateAndFlattenAttributes(schema []byte, doc map[string]any, emptyMessage string) (CreateAttributes, error) {
	var jschema jsonschema.Schema
	if err := json.Unmarshal(schema, &jschema); err != nil {
		return nil, ErrInternal(err).WithMessage("failed to unmarshal json schema")
	}
	if err := jschema.Validate(doc); err != nil {
		return nil, ErrUserInvalid().WithParent(err).WithMessage("user is not valid according to schema")
	}

	var mschema map[string]any
	if err := json.Unmarshal(schema, &mschema); err != nil {
		return nil, ErrInternal(err).WithMessage("failed to unmarshal schema map")
	}
	attrs, err := CreateAttributesFromMap(doc, mschema)
	if err != nil {
		return nil, ErrInternal(err).WithMessage("failed to flatten user attributes")
	}
	if len(attrs) == 0 {
		return nil, ErrUserInvalid().WithMessage(emptyMessage)
	}
	return attrs, nil
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
