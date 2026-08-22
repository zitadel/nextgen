package service

import (
	"context"
	"time"

	"github.com/zitadel/nextgen/internal/authz/compiler"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

type StatementPool interface {
	Statementer[AllStatements]
	Transactioner[AllStatements]
}

type Statements interface {
	IsStatements()
}

// ManagedIDGenerator mints prefixed managed resource IDs.
type ManagedIDGenerator interface {
	NewManagedID(prefix string) (string, error)
}

type AllStatements interface {
	ManagedIDGenerator
	ProjectStatements
	FlowDefinitionStatements
	CryptoKeyStatements
	JSONSchemaStatements
	TeamStatements
	TeamMembershipStatements
	TokenStatements
	SessionStatements
	AuthAttemptStatements
	UserStatements
	UserPasswordStatements
	UserTOTPStatements
	UserPasskeyStatements
	UserRecoveryCodesStatements
	BrandingStatements
	ClaimStatements
	ResourceScopeStatements
	AuthzAssignmentStatements
	AuthzMembershipEdgeStatements
	AuthzCatalogStatements
	AuthzResolverStatements
	EventStatements
	Statements
}

// TODO(adlerhurst): until go 1.27 only [StatementPool] and [Statements] are used, the rest is prepared for generic methods
// type ProjectPool interface {
// 	Statementer[ProjectStatements]
// 	Transactioner[ProjectStatements]
// }

type ProjectStatements interface {
	Statements
	CreateProject(ctx context.Context, entity *domain.Project) error
	GetProjectByID(ctx context.Context, id string) (*domain.Project, error)
	UpdateProject(ctx context.Context, entity *domain.Project) error
	ListProjects(ctx context.Context, filter *database.ListOptions[domain.ProjectField]) (*database.ListResult[*domain.Project], error)
	// DeleteProjectByID removes the project. changed is false when no row matched.
	DeleteProjectByID(ctx context.Context, id string) (changed bool, err error)
}

// TODO(adlerhurst): until go 1.27 only [StatementPool] and [Statements] are used, the rest is prepared for generic methods
// type FlowDefinitionPool interface {
// 	Statementer[FlowDefinitionStatements]
// 	Transactioner[FlowDefinitionStatements]
// }

type FlowDefinitionStatements interface {
	Statements
	CreateFlowDefinition(ctx context.Context, entity *domain.FlowDefinition) error
	GetFlowDefinitionByID(ctx context.Context, projectID, id string) (*domain.FlowDefinition, error)
	UpdateFlowDefinition(ctx context.Context, entity *domain.FlowDefinition) error
	ListFlowDefinitions(ctx context.Context, filter *database.ListOptions[domain.FlowDefinitionField]) (*database.ListResult[*domain.FlowDefinition], error)
	DeleteFlowDefinitionByID(ctx context.Context, projectID, id string) error
}

type CryptoKeyStatements interface {
	Statements
	GetEncryptionKey(ctx context.Context, filter database.Filter[domain.EncryptionKeyField]) (*domain.EncryptionKey, error)
	ListEncryptionKeys(ctx context.Context, opts *database.ListOptions[domain.EncryptionKeyField]) (*database.ListResult[*domain.EncryptionKey], error)
	CreateEncryptionKey(ctx context.Context, key *domain.EncryptionKey) error
	UpdateKey(ctx context.Context, id string, key string) error
	GetSigningKey(ctx context.Context, filter database.Filter[domain.SigningKeyField]) (*domain.SigningKey, error)
	CreateSigningKey(ctx context.Context, key *domain.SigningKey) error
}

// TODO(adlerhurst): until go 1.27 only [StatementPool] and [Statements] are used, the rest is prepared for generic methods
// type JSONSchemaPool interface {
// 	Statementer[JSONSchemaStatements]
// 	Transactioner[JSONSchemaStatements]
// }

type JSONSchemaStatements interface {
	Statements
	CreateJSONSchema(ctx context.Context, entity *domain.JSONSchema) error
	GetJSONSchemaByID(ctx context.Context, projectID, schemaID string) (*domain.JSONSchema, error)
	ListJSONSchemas(ctx context.Context, filter *database.ListOptions[domain.JSONSchemaField]) (*database.ListResult[*domain.JSONSchema], error)
	DeleteJSONSchemaByID(ctx context.Context, projectID, schemaID string) error
}

// TODO(adlerhurst): until go 1.27 only [StatementPool] and [Statements] are used, the rest is prepared for generic methods
// type TeamPool interface {
// 	Statementer[TeamStatements]
// 	Transactioner[TeamStatements]
// }

type TeamStatements interface {
	Statements
	CreateTeam(ctx context.Context, entity *domain.Team) error
	GetTeamByID(ctx context.Context, projectID, id string) (*domain.Team, error)
	UpdateTeam(ctx context.Context, entity *domain.Team) error
	ListTeams(ctx context.Context, filter *database.ListOptions[domain.TeamField]) (*database.ListResult[*domain.Team], error)
	// DeactivateTeam tombs the team and cascades membership/user lifecycle
	// updates. It wraps the multi-write steps in withTransaction (opens a tx
	// via Statements(), joins an outer pool.Transaction when already nested).
	//
	// Only an active team is deactivated: the team UPDATE is guarded on the status,
	// and a zero-row result skips the cascade and reports success with changed=false.
	// An unknown or already-deactivated team is therefore a no-op;
	// updated_at records when the team was first deactivated.
	DeactivateTeam(ctx context.Context, projectID, id string) (changed bool, err error)
}

// TODO(adlerhurst): until go 1.27 only [StatementPool] and [Statements] are used, the rest is prepared for generic methods
// type TeamMembershipPool interface {
// 	Statementer[TeamMembershipStatements]
// 	Transactioner[TeamMembershipStatements]
// }

type TeamMembershipStatements interface {
	Statements
	CreateTeamMembership(ctx context.Context, membership *domain.TeamMembership) error
	GetTeamMembership(ctx context.Context, projectID, teamID, userID string) (*domain.TeamMembership, error)
	ListTeamMemberships(ctx context.Context, filter *database.ListOptions[domain.TeamMembershipField]) (*database.ListResult[*domain.TeamMembership], error)
	ListUserTeams(ctx context.Context, filter *database.ListOptions[domain.UserTeamField]) (*database.ListResult[*domain.UserTeam], error)
	UpdateTeamMembershipStatus(ctx context.Context, projectID, teamID, userID string, status domain.MembershipStatus) error
}

// TODO(adlerhurst): until go 1.27 only [StatementPool] and [Statements] are used, the rest is prepared for generic methods
// type TokenPool interface {
// 	Statementer[TokenStatements]
// 	Transactioner[TokenStatements]
// }

type TokenStatements interface {
	Statements
	CreateToken(ctx context.Context, entity *domain.Token) error
	GetTokenByID(ctx context.Context, projectID, tokenID string) (*domain.Token, error)
	ListTokens(ctx context.Context, filter *database.ListOptions[domain.TokenField]) (*database.ListResult[*domain.Token], error)
	DeleteTokenByID(ctx context.Context, projectID, tokenID string) error
	DeleteTokensBySessionID(ctx context.Context, projectID, sessionID string) error
}

// TODO(adlerhurst): until go 1.27 only [StatementPool] and [Statements] are used, the rest is prepared for generic methods
// type SessionPool interface {
// 	Statementer[SessionStatements]
// 	Transactioner[SessionStatements]
// }

type SessionStatements interface {
	Statements
	// CreateSession inserts user_agent (optional), session, and session token.
	// It wraps the multi-write steps in withTransaction.
	CreateSession(ctx context.Context, entity *domain.Session) error
	// ExchangeSession promotes verified auth-attempt checks onto a session
	// (create or upgrade), rotates the session token, and deletes the attempt.
	// It wraps the multi-write steps in withTransaction.
	// idempotencyKey is accepted for API compatibility and currently ignored.
	ExchangeSession(ctx context.Context, projectID, handoffToken string, idempotencyKey *string, ttl time.Duration) (*domain.Session, error)
	GetSessionByID(ctx context.Context, projectID, sessionID string) (*domain.Session, error)
	ListSessions(ctx context.Context, filter *database.ListOptions[domain.SessionField]) (*database.ListResult[*domain.Session], error)
	DeleteSessionByID(ctx context.Context, projectID, sessionID string) error
}

// TODO(adlerhurst): until go 1.27 only [StatementPool] and [Statements] are used, the rest is prepared for generic methods
// type AuthAttemptPool interface {
// 	Statementer[AuthAttemptStatements]
// 	Transactioner[AuthAttemptStatements]
// }

type AuthAttemptStatements interface {
	Statements
	CreateAuthAttempt(ctx context.Context, entity *domain.AuthAttempt) error
	GetAuthAttemptByID(ctx context.Context, projectID, authAttemptID string) (*domain.AuthAttempt, error)
	GetAuthAttemptByHandoffToken(ctx context.Context, projectID string, handoffToken []byte) (*domain.AuthAttempt, error)
	DeleteAuthAttemptByID(ctx context.Context, projectID, authAttemptID string) error
	HandoffAuthAttempt(ctx context.Context, attempt *domain.AuthAttempt) error
	SetAuthAttemptChallenge(ctx context.Context, projectID, authAttemptID string, challenge domain.AuthChallenge) error
	// SetAuthAttemptFactor upserts a verified factor directly, without a
	// challenge/proof cycle: the caller has already established the fact by
	// other means (e.g. the user row was just created in the same transaction).
	// An existing check row of the same type is overwritten and its challenge
	// state cleared. Returns the check row's id for audit emits.
	SetAuthAttemptFactor(ctx context.Context, projectID, authAttemptID string, factor domain.AuthFactor) (checkID string, err error)
	AuthAttemptChallengeSucceeded(ctx context.Context, projectID, authAttemptID string, factor domain.AuthFactor, challengeID string) error
	AuthAttemptChallengeFailed(ctx context.Context, projectID, authAttemptID string, challenge domain.AuthChallenge) error
}

// UserQueryOptions carries EAV match/hydrate options for GetUser / ListUsers.
// Column predicates stay in Filter / ListOptions.
type UserQueryOptions struct {
	// AttributeKeys limits hydrated EAV keys; empty means all attributes.
	AttributeKeys []string
	// Attributes, when non-empty, restricts to users matching all key/value pairs.
	Attributes []domain.Attribute
	// MembershipTeamID, when set, requires an active team membership.
	MembershipTeamID *string
}

// TODO(adlerhurst): until go 1.27 only [StatementPool] and [Statements] are used, the rest is prepared for generic methods
// type UserPool interface {
// 	Statementer[UserStatements]
// 	Transactioner[UserStatements]
// }

type UserStatements interface {
	Statements
	CreateUser(ctx context.Context, user *domain.CreateUser) error
	GetUser(ctx context.Context, filter database.Filter[domain.UserField], opts UserQueryOptions) (*domain.User, error)
	ListUsers(ctx context.Context, filter *database.ListOptions[domain.UserField], opts UserQueryOptions) (*database.ListResult[*domain.User], error)
	DeactivateUser(ctx context.Context, projectID, userID string) error
	DeleteUserByID(ctx context.Context, projectID, userID string) error
	UserExists(ctx context.Context, projectID, userID string) (bool, error)
}

// TODO(adlerhurst): until go 1.27 only [StatementPool] and [Statements] are used, the rest is prepared for generic methods
// type UserPasswordPool interface {
// 	Statementer[UserPasswordStatements]
// 	Transactioner[UserPasswordStatements]
// }

type UserPasswordStatements interface {
	Statements
	SetUserPassword(ctx context.Context, pw *domain.SetUserPassword) error
	GetUserPassword(ctx context.Context, filter database.Filter[domain.UserPasswordField]) (*domain.UserPassword, error)
	ListUserPasswords(ctx context.Context, filter *database.ListOptions[domain.UserPasswordField]) (*database.ListResult[*domain.UserPassword], error)
	UpdateUserPassword(ctx context.Context, filter database.Filter[domain.UserPasswordField], updates ...domain.UserPasswordUpdate) error
	DeleteUserPassword(ctx context.Context, filter database.Filter[domain.UserPasswordField]) error
}

// TODO(adlerhurst): until go 1.27 only [StatementPool] and [Statements] are used, the rest is prepared for generic methods
// type UserTOTPPool interface {
// 	Statementer[UserTOTPStatements]
// 	Transactioner[UserTOTPStatements]
// }

type UserTOTPStatements interface {
	Statements
	CreateUserTOTP(ctx context.Context, totp *domain.CreateUserTOTP) error
	GetUserTOTP(ctx context.Context, filter database.Filter[domain.UserTOTPField]) (*domain.UserTOTP, error)
	ListUserTOTPs(ctx context.Context, filter *database.ListOptions[domain.UserTOTPField]) (*database.ListResult[*domain.UserTOTP], error)
	UpdateUserTOTP(ctx context.Context, filter database.Filter[domain.UserTOTPField], updates ...domain.UserTOTPUpdate) error
	DeleteUserTOTP(ctx context.Context, filter database.Filter[domain.UserTOTPField]) error
}

// TODO(adlerhurst): until go 1.27 only [StatementPool] and [Statements] are used, the rest is prepared for generic methods
// type UserPasskeyPool interface {
// 	Statementer[UserPasskeyStatements]
// 	Transactioner[UserPasskeyStatements]
// }

type UserPasskeyStatements interface {
	Statements
	CreateUserPasskey(ctx context.Context, passkey *domain.CreateUserPasskey) error
	GetUserPasskey(ctx context.Context, filter database.Filter[domain.UserPasskeyField]) (*domain.UserPasskey, error)
	ListUserPasskeys(ctx context.Context, filter *database.ListOptions[domain.UserPasskeyField]) (*database.ListResult[*domain.UserPasskey], error)
	UpdateUserPasskey(ctx context.Context, filter database.Filter[domain.UserPasskeyField], updates ...domain.UserPasskeyUpdate) error
	DeleteUserPasskey(ctx context.Context, filter database.Filter[domain.UserPasskeyField]) error
}

// TODO(adlerhurst): until go 1.27 only [StatementPool] and [Statements] are used, the rest is prepared for generic methods
// type UserRecoveryCodesPool interface {
// 	Statementer[UserRecoveryCodesStatements]
// 	Transactioner[UserRecoveryCodesStatements]
// }

type UserRecoveryCodesStatements interface {
	Statements
	CreateUserRecoveryCodes(ctx context.Context, codes *domain.CreateRecoveryCodes) error
	GetUserRecoveryCodes(ctx context.Context, filter database.Filter[domain.UserRecoveryCodesField]) (*domain.UserRecoveryCodes, error)
	ListUserRecoveryCodes(ctx context.Context, filter *database.ListOptions[domain.UserRecoveryCodesField]) (*database.ListResult[*domain.UserRecoveryCodes], error)
	UpdateUserRecoveryCodes(ctx context.Context, filter database.Filter[domain.UserRecoveryCodesField], updates ...domain.UserRecoveryCodesUpdate) error
	DeleteUserRecoveryCodes(ctx context.Context, filter database.Filter[domain.UserRecoveryCodesField]) error
}

type BrandingStatements interface {
	Statements
	CreateBranding(ctx context.Context, entity *domain.Branding) error
	GetBrandingByID(ctx context.Context, projectID, id string) (*domain.Branding, error)
	ListBrandings(ctx context.Context, filter *database.ListOptions[domain.BrandingField]) (*database.ListResult[*domain.Branding], error)
}

// TODO(IAM-marco): until go 1.27 only [StatementPool] and [Statements] are used, the rest is prepared for generic methods
// type ClaimPool interface {
// 	Statementer[ClaimStatements]
// 	Transactioner[ClaimStatements]
// }

type ClaimStatements interface {
	Statements
	// CreateChallenge inserts a pending claim challenge; entity.ID is the
	// SHA-256 hash of the challenge token, minted by the caller.
	CreateChallenge(ctx context.Context, entity *domain.ClaimChallenge) error
	GetChallengeByID(ctx context.Context, projectID, id string) (*domain.ClaimChallenge, error)
	// MarkChallengeCompleted flips pending -> completed; a challenge that is
	// absent, in another project, or already completed returns NoRowFoundError.
	MarkChallengeCompleted(ctx context.Context, projectID, id string) error
	// GetPersonalTeamForUser resolves the user's earliest membership as the
	// personal team and returns NoRowFoundError when that membership or its team
	// is not active. It never falls back to a later membership: a deactivated
	// personal team is not silently replaced by another team the user belongs to.
	GetPersonalTeamForUser(ctx context.Context, projectID, userID string) (*domain.Team, error)
}

// ResourceScopeStatements persists resource_scope_index rows (path.id → project/team).
//
// Use cases:
//   - UpsertResourceScope: dual-write on project/team/user/schema/branding/
//     flow_definition/session create (build via domain.New*ResourceScope).
//   - GetResourceScope: tests/oracle only when resource_id is known globally unique;
//     must not be used by the HTTP management gate (schema $id URLs are not).
//   - GetResourceScopeInProject: gate lookup by kind + credential project + path.id.
//   - GetResourceScopeByIDInProject: gate wrong-kind fallback (same project, any kind).
//   - ExistsResourceScopeElsewhere: gate delete path — foreign presence without
//     requiring a unique global resource_id.
//   - DeleteResourceScope: explicit cleanup where FK cascade does not apply (user /
//     schema / flow_definition / session delete today; branding relies on project
//     cascade; project delete cascades RSI via project_id FK).
type ResourceScopeStatements interface {
	Statements
	UpsertResourceScope(ctx context.Context, scope *domain.ResourceScope) error
	GetResourceScope(ctx context.Context, resourceID string) (*domain.ResourceScope, error)
	GetResourceScopeInProject(ctx context.Context, kind domain.ResourceKind, projectID, resourceID string) (*domain.ResourceScope, error)
	GetResourceScopeByIDInProject(ctx context.Context, projectID, resourceID string) (*domain.ResourceScope, error)
	ExistsResourceScopeElsewhere(ctx context.Context, kind domain.ResourceKind, resourceID, excludeProjectID string) (bool, error)
	DeleteResourceScope(ctx context.Context, kind domain.ResourceKind, projectID, resourceID string) error
}

// AuthzAssignmentStatements persists grants (principal → catalog relation at a scope).
//
// Use cases: grant/revoke product APIs and resolver reads — not dual-write from CreateUser.
// Create/Revoke are the write path; Get/List support admin and check-time lookup.
type AuthzAssignmentStatements interface {
	Statements
	CreateAuthzAssignment(ctx context.Context, assignment *domain.AuthzAssignment) error
	GetAuthzAssignment(ctx context.Context, projectID, id string) (*domain.AuthzAssignment, error)
	ListAuthzAssignments(ctx context.Context, projectID string, principalType domain.AuthzPrincipalType, principalID string, includeRevoked bool) ([]*domain.AuthzAssignment, error)
	RevokeAuthzAssignment(ctx context.Context, projectID, id string) error
	// GetActiveOwningTeamGrant returns the project's active owning-team grant
	// (object project, relation team) or NoRowFoundError when the project is
	// unclaimed. The unique active grant is the claim source of truth
	// (ADR 046 / ADR 054 §2); at most one active row exists per project,
	// enforced by authz_assignments_one_owning_team.
	GetActiveOwningTeamGrant(ctx context.Context, projectID string) (*domain.AuthzAssignment, error)
	// ListClaimedProjectIDs returns project ids holding an active owning-team
	// grant (ADR 049 export visibility), ordered by project_id after afterID
	// (empty starts at the beginning).
	ListClaimedProjectIDs(ctx context.Context, afterID string, limit uint32) ([]string, error)
}

// AuthzMembershipEdgeStatements persists the authz projection of set membership.
// The resolver reads these edges, not team_memberships (roster/lifecycle stays separate).
//
// Use cases:
//   - Upsert: low-level row ops. Prefer [SyncUserTeamMembershipEdge] for roster status changes.
//   - DeleteAuthzMembershipEdges: column-shaped deletes via Filter (single edge, by member, by set).
//   - DeleteAuthzMembershipEdgesForTeamDeactivate: team deactivate (team set + lifecycle-owned users).
//   - Get/ListByMember: resolver / dual-write test reads.
type AuthzMembershipEdgeStatements interface {
	Statements
	UpsertAuthzMembershipEdge(ctx context.Context, edge *domain.AuthzMembershipEdge) error
	GetAuthzMembershipEdge(ctx context.Context, key domain.AuthzMembershipEdgeKey) (*domain.AuthzMembershipEdge, error)
	ListAuthzMembershipEdgesByMember(ctx context.Context, projectID string, memberType domain.AuthzMemberType, memberID string) ([]*domain.AuthzMembershipEdge, error)
	DeleteAuthzMembershipEdges(ctx context.Context, filter database.Filter[domain.AuthzMembershipEdgeField]) error
	DeleteAuthzMembershipEdgesForTeamDeactivate(ctx context.Context, projectID, teamID string) error
}

// SyncUserTeamMembershipEdge projects a team_memberships status change onto authz_membership_edges:
// authz-active statuses upsert the user→team edge; otherwise the edge is deleted.
func SyncUserTeamMembershipEdge(ctx context.Context, edges AuthzMembershipEdgeStatements, projectID, teamID, userID string, status domain.MembershipStatus) error {
	if status.IsAuthzActive() {
		return edges.UpsertAuthzMembershipEdge(ctx, domain.NewUserTeamMembershipEdge(projectID, teamID, userID))
	}
	return edges.DeleteAuthzMembershipEdges(ctx, database.And(
		database.Equal(database.Col(domain.AuthzMembershipEdgeFieldProjectID), projectID),
		database.Equal(database.Col(domain.AuthzMembershipEdgeFieldSetType), domain.AuthzSetTypeTeam),
		database.Equal(database.Col(domain.AuthzMembershipEdgeFieldSetID), teamID),
		database.Equal(database.Col(domain.AuthzMembershipEdgeFieldMemberType), domain.AuthzMemberTypeUser),
		database.Equal(database.Col(domain.AuthzMembershipEdgeFieldMemberID), userID),
	))
}

// AuthzCatalogStatements persists a compiled catalog version (#720 → Wave 1 tables).
//
// PersistCatalogVersion inserts authz_catalogs plus relations, relation
// references, expression edges, and closure. It does not write RSI,
// assignments, membership edges, or bundles. Retires any previously active
// catalog for the same (catalog_kind, owner_id).
//
// GetAuthzCatalog loads one catalog version and its projected child rows by id.
//
// LoadCatalogMutations reads the child rows PersistCatalogVersion wrote as
// compiler.PersistedCatalog (stmttest round-trip and L4 oracle catalog load).
type AuthzCatalogStatements interface {
	Statements
	PersistCatalogVersion(ctx context.Context, meta domain.AuthzCatalogVersion, mutations compiler.CatalogMutations) error
	GetAuthzCatalog(ctx context.Context, catalogID string) (*domain.AuthzCatalog, error)
	LoadCatalogMutations(ctx context.Context, catalogID string) (compiler.PersistedCatalog, error)
}

// AuthzResolverStatements is the storage surface for permission Check / list (#423).
//
// Use cases:
//   - ActiveSystemCatalogID: active system catalog (kind=system, owner=system).
//   - HasAuthzProjectFoothold: any active assignment or membership edge in project.
//   - CheckAuthz: allowed + foothold in one round-trip (assignments, closure, membership, TTU).
//   - ListAuthzObjectIDs: L4/oracle helper materializing authorized RSI ids for one kind.
//     List *endpoints* compose an injectable SQL predicate (ADR 033); that lands with HTTP wiring.
type AuthzResolverStatements interface {
	Statements
	ActiveSystemCatalogID(ctx context.Context) (string, error)
	HasAuthzProjectFoothold(ctx context.Context, projectID string, principalType domain.AuthzPrincipalType, principalID string) (bool, error)
	CheckAuthz(ctx context.Context, params domain.AuthzCheckParams) (allowed bool, foothold bool, err error)
	ListAuthzObjectIDs(ctx context.Context, params domain.AuthzListObjectsParams) ([]string, error)
}

// EventStatements persists append-only wide events (ADR 048).
type EventStatements interface {
	Statements
	InsertEvent(ctx context.Context, event *domain.Event) error
	GetEventByID(ctx context.Context, projectID, id string) (*domain.Event, error)
	ListEvents(ctx context.Context, filter *database.ListOptions[domain.EventField]) (*database.ListResult[*domain.Event], error)
	// DeleteEventsOlderThan removes events with created_at before cutoff across
	// all projects (retention job; includes orphaned project_id rows).
	DeleteEventsOlderThan(ctx context.Context, createdBefore time.Time) (int64, error)
	EnsureEventSink(ctx context.Context, sink *domain.EventSink) error
	// GetEventSinkCursor returns (nil, nil) when no cursor row exists.
	GetEventSinkCursor(ctx context.Context, sinkID, projectID string) (*domain.EventSinkCursor, error)
	UpsertEventSinkCursor(ctx context.Context, cursor *domain.EventSinkCursor) error
	ListEventsAfterCursor(ctx context.Context, projectID string, afterCreatedAt time.Time, afterID string, limit uint32) ([]*domain.Event, error)
}
