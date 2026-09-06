package domain

import (
	"time"
)

// System catalog identity (must match Goose seed).
const (
	SystemCatalogID      = "cat_sys_1"
	SystemCatalogOwnerID = "system"
)

// PrefixAuthzAssignment is the dialect-minted ID prefix for authz_assignments (asgn_<opaque>).
const PrefixAuthzAssignment ResourcePrefix = "asgn"

// ResourceKind is the resource_scope_index.resource_kind discriminator.
type ResourceKind string

const (
	ResourceKindProject        ResourceKind = "project"
	ResourceKindTeam           ResourceKind = "team"
	ResourceKindUser           ResourceKind = "user"
	ResourceKindSchema         ResourceKind = "schema"
	ResourceKindBranding       ResourceKind = "branding"
	ResourceKindFlowDefinition ResourceKind = "flow_definition"
	ResourceKindSession        ResourceKind = "session"
	ResourceKindEnvironment    ResourceKind = "environment"
	ResourceKindRelease        ResourceKind = "release"
)

func (k ResourceKind) String() string { return string(k) }

// TeamBoundObjectType reports whether objectType is always team-scoped for
// sk_team_ principals (user, team, team_membership, event). Mint-time
// validation and the sk_team allowlist share this set so a new allowlist
// entry cannot silently allow project-scoped minting.
func TeamBoundObjectType(objectType string) bool {
	switch objectType {
	case "user", "team", "team_membership", "event":
		return true
	default:
		return false
	}
}

// AuthzMemberType is authz_membership_edges.member_type.
type AuthzMemberType string

const (
	AuthzMemberTypeUser AuthzMemberType = "user"
)

func (t AuthzMemberType) String() string { return string(t) }

// AuthzSetType is authz_membership_edges.set_type.
type AuthzSetType string

const (
	AuthzSetTypeTeam AuthzSetType = "team"
)

func (t AuthzSetType) String() string { return string(t) }

// AuthzCatalogKind is authz_catalogs.catalog_kind.
type AuthzCatalogKind string

const (
	AuthzCatalogKindSystem   AuthzCatalogKind = "system"
	AuthzCatalogKindAppGroup AuthzCatalogKind = "app_group"
)

func (k AuthzCatalogKind) String() string { return string(k) }

// AuthzCatalogStatus is authz_catalogs.status.
type AuthzCatalogStatus string

const (
	AuthzCatalogStatusDraft   AuthzCatalogStatus = "draft"
	AuthzCatalogStatusActive  AuthzCatalogStatus = "active"
	AuthzCatalogStatusRetired AuthzCatalogStatus = "retired"
)

func (s AuthzCatalogStatus) String() string { return string(s) }

// AuthzRelationKind is authz_relations.kind.
type AuthzRelationKind string

const (
	AuthzRelationKindRelation   AuthzRelationKind = "relation"
	AuthzRelationKindPermission AuthzRelationKind = "permission"
)

func (k AuthzRelationKind) String() string { return string(k) }

// AuthzPrincipalType is authz_assignments.principal_type (no project principals; see D13).
type AuthzPrincipalType string

const (
	AuthzPrincipalTypeUser   AuthzPrincipalType = "user"
	AuthzPrincipalTypeTeam   AuthzPrincipalType = "team"
	AuthzPrincipalTypeAgent  AuthzPrincipalType = "agent"
	AuthzPrincipalTypeSKProj AuthzPrincipalType = "sk_proj"
	AuthzPrincipalTypeSKTeam AuthzPrincipalType = "sk_team"
)

func (t AuthzPrincipalType) String() string { return string(t) }

// AuthzScopeKind is authz_assignments.scope_kind.
type AuthzScopeKind string

const (
	AuthzScopeKindProject  AuthzScopeKind = "project"
	AuthzScopeKindTeam     AuthzScopeKind = "team"
	AuthzScopeKindResource AuthzScopeKind = "resource"
)

func (k AuthzScopeKind) String() string { return string(k) }

// AuthzCatalogVersion is the catalog row metadata written with a compiled
// CatalogMutations payload (see PersistCatalogVersion).
type AuthzCatalogVersion struct {
	ID          string
	CatalogKind AuthzCatalogKind
	OwnerID     string
	Version     int
	SourceHash  *string
}

// AuthzCatalog is one persisted catalog version plus its projected relation
// rows (authz_relations / references / expression_edges / relation_closure).
type AuthzCatalog struct {
	ID          string
	CatalogKind AuthzCatalogKind
	OwnerID     string
	Version     int
	Status      AuthzCatalogStatus
	SourceHash  *string
	Relations   []AuthzRelation
	References  []AuthzRelationReference
	Edges       []AuthzExpressionEdge
	Closure     []AuthzRelationClosure
}

// AuthzRelation is one authz_relations row.
type AuthzRelation struct {
	ObjectType string
	Relation   string
	Kind       AuthzRelationKind
}

// AuthzRelationReference is one authz_relation_references row.
type AuthzRelationReference struct {
	ObjectType  string
	Relation    string
	RefType     string
	RefRelation string
	Wildcard    bool
	Condition   string
	Position    int
}

// AuthzExpressionEdge is one authz_expression_edges row.
// Kind is the CHECK value: direct | computed_userset | tuple_to_userset.
type AuthzExpressionEdge struct {
	ObjectType         string
	Relation           string
	Kind               string
	SourceObjectType   *string
	SourceRelation     *string
	TuplesetObjectType *string
	TuplesetRelation   *string
	Position           int
}

// AuthzRelationClosure is one authz_relation_closure row.
type AuthzRelationClosure struct {
	FromObjectType string
	FromRelation   string
	ToObjectType   string
	ToRelation     string
	Depth          int
}

// ResourceScope maps a globally addressable resource id to project/team scope
// (resource_scope_index). Answers "where does this path.id live?" for middleware
// and the future resolver — not a permission grant.
type ResourceScope struct {
	ResourceID   string
	ResourceKind ResourceKind
	ProjectID    string
	TeamID       *string
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

func NewProjectResourceScope(projectID string) *ResourceScope {
	return &ResourceScope{
		ResourceID:   projectID,
		ResourceKind: ResourceKindProject,
		ProjectID:    projectID,
	}
}

func NewTeamResourceScope(projectID, teamID string) *ResourceScope {
	id := teamID
	return &ResourceScope{
		ResourceID:   teamID,
		ResourceKind: ResourceKindTeam,
		ProjectID:    projectID,
		TeamID:       &id,
	}
}

// NewResourceScope builds a project-scoped RSI row (no team).
func NewResourceScope(kind ResourceKind, projectID, resourceID string) *ResourceScope {
	return &ResourceScope{
		ResourceID:   resourceID,
		ResourceKind: kind,
		ProjectID:    projectID,
	}
}

func NewUserResourceScope(projectID, userID string) *ResourceScope {
	return NewResourceScope(ResourceKindUser, projectID, userID)
}

// AuthzAssignmentScope encodes the CHECK-constrained scope columns.
type AuthzAssignmentScope struct {
	Kind       AuthzScopeKind
	TeamID     *string
	ResourceID *string
}

func NewProjectAssignmentScope() AuthzAssignmentScope {
	return AuthzAssignmentScope{Kind: AuthzScopeKindProject}
}

func NewTeamAssignmentScope(teamID string) AuthzAssignmentScope {
	id := teamID
	return AuthzAssignmentScope{Kind: AuthzScopeKindTeam, TeamID: &id}
}

func NewResourceAssignmentScope(resourceID string) AuthzAssignmentScope {
	id := resourceID
	return AuthzAssignmentScope{Kind: AuthzScopeKindResource, ResourceID: &id}
}

// AuthzAssignment binds a principal to a catalog relation at an explicit scope.
// This is a grant row for the grants API / resolver — not dual-written from
// ordinary CreateUser/CreateTeam.
//
// Relation identity is (ObjectType, Relation), matching authz_relations.
type AuthzAssignment struct {
	ID              string
	ProjectID       string
	CatalogID       string
	PrincipalType   AuthzPrincipalType
	PrincipalID     string
	ObjectType      string
	Relation        string
	ScopeKind       AuthzScopeKind
	ScopeTeamID     *string
	ScopeResourceID *string
	GrantorType     *string
	GrantorID       *string
	DelegationID    *string
	ExpiresAt       *time.Time
	RevokedAt       *time.Time
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

// ApplyScope sets the scope columns from a constructor-built scope value.
func (a *AuthzAssignment) ApplyScope(scope AuthzAssignmentScope) {
	a.ScopeKind = scope.Kind
	a.ScopeTeamID = scope.TeamID
	a.ScopeResourceID = scope.ResourceID
}

// AuthzAssignmentField enumerates assignment columns that can be used for
// filtering and ordering the managed-grants list.
type AuthzAssignmentField uint8

const (
	AuthzAssignmentFieldUnspecified AuthzAssignmentField = iota
	AuthzAssignmentFieldProjectID
	AuthzAssignmentFieldID
	AuthzAssignmentFieldPrincipalType
	AuthzAssignmentFieldPrincipalID
	AuthzAssignmentFieldRelation
	AuthzAssignmentFieldCreatedAt
	AuthzAssignmentFieldExpiresAt
)

// NewSKProjProjectSetupAssignment is the grant seeded at CreateProject so the
// returned full project secret can set up the project via resolver.Check.
//
// Relation is project.viewer (not admin): the seeded system catalog closure
// treats viewer as the assigned relation that satisfies viewer/editor/admin
// checks (placeholders pending #420). PrincipalID equals the project id so the
// grant survives secret rotate/claim.
func NewSKProjProjectSetupAssignment(projectID string) *AuthzAssignment {
	a := &AuthzAssignment{
		ProjectID:     projectID,
		CatalogID:     SystemCatalogID,
		PrincipalType: AuthzPrincipalTypeSKProj,
		PrincipalID:   projectID,
		ObjectType:    "project",
		Relation:      "viewer",
	}
	a.ApplyScope(NewProjectAssignmentScope())
	return a
}

// NewClaimTeamAssignment is the grant claim/complete writes (ADR 046 §1): the
// team principal on the seeded project.team relation at project scope, making
// the project owned by the claiming user's personal team. Grantor columns stay
// unset — the schema CHECK ties grantor_id to delegation_id, so claimed-by
// provenance is carried by the authz.granted audit event's actor instead.
func NewClaimTeamAssignment(projectID, teamID string) *AuthzAssignment {
	a := &AuthzAssignment{
		ProjectID:     projectID,
		CatalogID:     SystemCatalogID,
		PrincipalType: AuthzPrincipalTypeTeam,
		PrincipalID:   teamID,
		ObjectType:    "project",
		Relation:      "team",
	}
	a.ApplyScope(NewProjectAssignmentScope())
	return a
}

// AuthzMembershipEdge is the authz projection of set membership (not lifecycle).
// The resolver expands team grants through these edges; team_memberships remains
// the roster table and is not read at check time.
type AuthzMembershipEdge struct {
	ProjectID  string
	MemberType AuthzMemberType
	MemberID   string
	SetType    AuthzSetType
	SetID      string
	CreatedAt  time.Time
}

// AuthzMembershipEdgeKey identifies one authz_membership_edges row.
type AuthzMembershipEdgeKey struct {
	ProjectID  string
	SetType    AuthzSetType
	SetID      string
	MemberType AuthzMemberType
	MemberID   string
}

func NewUserTeamMembershipEdge(projectID, teamID, userID string) *AuthzMembershipEdge {
	return &AuthzMembershipEdge{
		ProjectID:  projectID,
		MemberType: AuthzMemberTypeUser,
		MemberID:   userID,
		SetType:    AuthzSetTypeTeam,
		SetID:      teamID,
	}
}

func NewUserTeamMembershipEdgeKey(projectID, teamID, userID string) AuthzMembershipEdgeKey {
	return AuthzMembershipEdgeKey{
		ProjectID:  projectID,
		SetType:    AuthzSetTypeTeam,
		SetID:      teamID,
		MemberType: AuthzMemberTypeUser,
		MemberID:   userID,
	}
}

// AuthzMembershipEdgeField enumerates AuthzMembershipEdge columns for filter deletes.
type AuthzMembershipEdgeField uint8

const (
	AuthzMembershipEdgeFieldUnspecified AuthzMembershipEdgeField = iota
	AuthzMembershipEdgeFieldProjectID
	AuthzMembershipEdgeFieldMemberType
	AuthzMembershipEdgeFieldMemberID
	AuthzMembershipEdgeFieldSetType
	AuthzMembershipEdgeFieldSetID
	AuthzMembershipEdgeFieldCreatedAt
)

// AuthzCheckParams is the storage-level input for a single-resource permission check.
// PrincipalHomeProjectID is the project used for membership-edge lookup (defaults to ProjectID).
//
// ConstraintTeamID, when set (sk_team_ tokens), requires the checked or listed
// object to belong to that team: users via authz_membership_edges, teams by id,
// other kinds via resource_scope_index.team_id (Check binds ResourceTeamID).
// ResourceID is the object being checked (empty for permission-level Check /
// list materialization). ResourceTeamID is RSI.team_id for by-id Check.
type AuthzCheckParams struct {
	CatalogID              string
	ProjectID              string
	PrincipalHomeProjectID string
	PrincipalType          AuthzPrincipalType
	PrincipalID            string
	ObjectType             string
	Relation               string
	ConstraintTeamID       string
	ResourceID             string
	// ResourceTeamID is RSI.team_id for by-id Check (team-scoped grant arm).
	ResourceTeamID string
}

// HomeProjectID returns PrincipalHomeProjectID, or ProjectID when unset.
func (p AuthzCheckParams) HomeProjectID() string {
	if p.PrincipalHomeProjectID != "" {
		return p.PrincipalHomeProjectID
	}
	return p.ProjectID
}

// AuthzListObjectsParams lists resource_scope_index ids the principal may see
// for one resource kind under a required catalog relation (L4 / oracle helper).
// Endpoint wiring injects an authz predicate into the resource query (ADR 033).
type AuthzListObjectsParams struct {
	AuthzCheckParams
	ResourceKind ResourceKind
}
