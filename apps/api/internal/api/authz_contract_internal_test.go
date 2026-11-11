package api

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"regexp"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	openapibundled "github.com/zitadel/nextgen/api/openapi/bundled"
	api "github.com/zitadel/nextgen/internal/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// The gate contract: for every operation that asks the resolver, which
// relation it asks, about which target, with which home, and what a denial
// answers. The stub other gate tests use answers every relation alike and
// ignores the target and the home, so only this table notices a handler that
// asks the wrong relation or a gate that stops forwarding the resource's team
// or the credential's project. It pins today's behavior; a row the catalog
// contradicts says so in `open` and stays as it is until that is decided.

const (
	viewer = "viewer"
	editor = "editor"
	admin  = "admin"
)

// gateTarget is what an operation's Check names as its target.
type gateTarget int

const (
	// onProject: the project the request names, project-wide.
	onProject gateTarget = iota
	// onOwnProject: the credential's own project, whatever the request names.
	onOwnProject
	// onResource: the path id, located through resource_scope_index first;
	// the Check names the row's project, the id and the row's team.
	onResource
	// onTarget: the path id, with no index row to locate it, in the project
	// the request names.
	onTarget
)

// gateRow is one gated operation's contract.
type gateRow struct {
	// op is the operation's ogen name: the spec's operationId, capitalized.
	op string
	// variant names the branch when one operation gates differently by what
	// it finds before the gate.
	variant string
	// cookie pins whether the spec lets the Console session cookie call it.
	cookie   bool
	relation string
	target   gateTarget
	// idField is the params field that carries the path id (onResource, onTarget).
	idField string
	// kind is the resource_scope_index kind the route expects (onResource).
	kind domain.ResourceKind
	// list marks a list gate: a foothold that does not cover the project
	// narrows the list instead of refusing it, so only NotFound is a denial.
	list bool
	// denied answers a Check that finds a foothold but no grant (403); miss
	// answers one that finds none (404 or the create's invalid project).
	denied, miss string
	// setup wires what the handler reads before its gate.
	setup func(*testing.T, *gateFixture, gateCall)
	// rsiID is the id the index lookup is asked for, when it is not the path id.
	rsiID string
	// open records where the catalog contradicts the relation asked. It is a
	// decision for the owners of the catalog, not a test expectation.
	open string
}

// gateCodes are one resource's answers.
type gateCodes struct{ denied, readMiss, writeMiss string }

var (
	brandingCodes   = gateCodes{domain.ErrBrandingPermissionDenied().Code, domain.ErrBrandingNotFound().Code, domain.ErrBrandingInvalid("", nil).Code}
	deploymentCodes = gateCodes{domain.ErrDeploymentPermissionDenied().Code, domain.ErrDeploymentNotFound().Code, domain.ErrEnvironmentProjectNotFound().Code}
	eventCodes      = gateCodes{domain.ErrEventPermissionDenied().Code, domain.ErrEventNotFound().Code, domain.ErrEventNotFound().Code}
	flowDefCodes    = gateCodes{domain.ErrFlowDefinitionPermissionDenied().Code, domain.ErrFlowDefinitionNotFound().Code, domain.ErrFlowDefinitionInvalid("", nil).Code}
	grantCodes      = gateCodes{domain.ErrGrantPermissionDenied().Code, domain.ErrGrantNotFound().Code, domain.ErrGrantNotFound().Code}
	idpCodes        = gateCodes{domain.ErrIDPConnectionPermissionDenied().Code, domain.ErrIDPConnectionNotFound().Code, domain.ErrIDPConnectionNotFound().Code}
	invitationCodes = gateCodes{domain.ErrInvitationPermissionDenied().Code, domain.ErrInvitationNotFound().Code, domain.ErrInvitationNotFound().Code}
	originCodes     = gateCodes{domain.ErrOriginPermissionDenied().Code, domain.ErrOriginNotFound().Code, domain.ErrOriginNotFound().Code}
	policyCodes     = gateCodes{domain.ErrPolicyPermissionDenied().Code, domain.ErrPolicyNotFound().Code, domain.ErrPolicyInvalid(nil, nil).Code}
	projectCodes    = gateCodes{domain.ErrProjectPermissionDenied().Code, domain.ErrProjectNotFound().Code, domain.ErrProjectNotFound().Code}
	releaseCodes    = gateCodes{domain.ErrReleasePermissionDenied().Code, domain.ErrReleaseNotFound().Code, domain.ErrReleaseProjectNotFound().Code}
	schemaCodes     = gateCodes{domain.ErrJSONSchemaPermissionDenied().Code, domain.ErrJSONSchemaNotFound().Code, domain.ErrJSONSchemaInvalid().Code}
	sessionCodes    = gateCodes{domain.ErrSessionPermissionDenied().Code, domain.ErrSessionNotFound().Code, domain.ErrSessionNotFound().Code}
	teamCodes       = gateCodes{domain.ErrTeamPermissionDenied().Code, domain.ErrTeamNotFound().Code, domain.ErrTeamProjectNotFound().Code}
	userCodes       = gateCodes{domain.ErrUserPermissionDenied().Code, domain.ErrUserNotFound().Code, domain.ErrUserInvalid().Code}
	variableCodes   = gateCodes{domain.ErrVariablePermissionDenied().Code, domain.ErrVariableNotFound().Code, domain.ErrVariableNotFound().Code}
)

// Open decisions: relations the catalog (docs/design/api/system-permission-catalog.md)
// contradicts. Each stays as the handler asks it until someone decides.
const (
	openWriteIsNotDelete = "the catalog says write never implies delete (system-permission-catalog.md:53), but this removal asks editor"
	openInvitationRead   = "ADR 086 asks admin for every invitation operation, reads included; the catalog folds invitations into team_membership.*, whose read the viewer bundle holds, and reading grants asks only viewer"
	openCredentialTier   = "credential-tier: the catalog keeps user.set_password to admin bundles (system-permission-catalog.md:175), but this asks editor; only the bearer-only plane keeps a platform-project editor off an operator's credential"
)

// gateRows is the contract table, one row per gated operation (two for an
// operation that gates by branch), grouped by resource.
var gateRows = []gateRow{
	// Branding.
	{op: "ListBranding", cookie: true, relation: viewer, target: onProject, list: true, miss: brandingCodes.readMiss},
	{op: "CreateBranding", relation: editor, target: onProject, denied: brandingCodes.denied, miss: brandingCodes.writeMiss},
	{op: "GetBrandingById", cookie: true, relation: viewer, target: onResource, idField: "ID", kind: domain.ResourceKindBranding, denied: brandingCodes.denied, miss: brandingCodes.readMiss},

	// Deployments and previews.
	{op: "ListDeployments", cookie: true, relation: viewer, target: onProject, list: true, miss: deploymentCodes.readMiss},
	{op: "CreateDeployment", cookie: true, relation: editor, target: onProject, denied: deploymentCodes.denied, miss: deploymentCodes.writeMiss},
	{op: "GetDeploymentById", cookie: true, relation: viewer, target: onProject, denied: deploymentCodes.denied, miss: deploymentCodes.readMiss},
	{op: "RollbackDeployment", cookie: true, relation: editor, target: onProject, denied: deploymentCodes.denied, miss: deploymentCodes.writeMiss},
	{op: "GetDeploymentVariables", relation: viewer, target: onProject, denied: deploymentCodes.denied, miss: deploymentCodes.readMiss},
	{op: "ListPreviews", relation: viewer, target: onProject, denied: deploymentCodes.denied, miss: deploymentCodes.readMiss},
	{op: "RemovePreview", relation: editor, target: onProject, denied: deploymentCodes.denied, miss: deploymentCodes.writeMiss, open: openWriteIsNotDelete},

	// Events.
	{op: "ListEvents", cookie: true, relation: viewer, target: onProject, denied: eventCodes.denied, miss: eventCodes.readMiss},
	{op: "GetEvent", cookie: true, relation: viewer, target: onProject, denied: eventCodes.denied, miss: eventCodes.readMiss},

	// Flow definitions.
	{op: "ListFlowDefinitions", cookie: true, relation: viewer, target: onProject, list: true, miss: flowDefCodes.readMiss},
	{op: "CreateFlowDefinition", relation: editor, target: onProject, denied: flowDefCodes.denied, miss: flowDefCodes.writeMiss},
	{op: "GetFlowDefinition", cookie: true, relation: viewer, target: onResource, idField: "ID", kind: domain.ResourceKindFlowDefinition, denied: flowDefCodes.denied, miss: flowDefCodes.readMiss},

	// Grants. Creating one asks admin: a grant can carry any role up to admin.
	{op: "CreateGrant", cookie: true, relation: admin, target: onProject, denied: grantCodes.denied, miss: grantCodes.readMiss},
	{op: "QueryGrants", cookie: true, relation: viewer, target: onProject, denied: grantCodes.denied, miss: grantCodes.readMiss},
	{op: "GetGrant", cookie: true, relation: viewer, target: onProject, denied: grantCodes.denied, miss: grantCodes.readMiss},
	{op: "DeleteGrant", cookie: true, relation: admin, target: onProject, denied: grantCodes.denied, miss: grantCodes.readMiss},

	// Identity provider connections.
	{op: "CreateIdp", relation: editor, target: onProject, denied: idpCodes.denied, miss: idpCodes.writeMiss},
	{op: "QueryIdps", cookie: true, relation: viewer, target: onProject, list: true, miss: idpCodes.readMiss},
	{op: "GetIdpById", cookie: true, relation: viewer, target: onResource, idField: "ID", kind: domain.ResourceKindIDPConnection, denied: idpCodes.denied, miss: idpCodes.readMiss},
	{op: "ListIdpRevisions", relation: viewer, target: onResource, idField: "ID", kind: domain.ResourceKindIDPConnection, denied: idpCodes.denied, miss: idpCodes.readMiss},
	// The revision is read before the gate: a found revision is checked on
	// its connection, an unknown one on its own id as the target (#2112).
	{
		op: "GetIdpRevisionById", variant: "revision found", cookie: true, relation: viewer, target: onResource,
		idField: "RevisionID", kind: domain.ResourceKindIDPConnection, rsiID: "idp_of_revision",
		denied: idpCodes.denied, miss: idpCodes.readMiss,
		setup: func(_ *testing.T, f *gateFixture, c gateCall) {
			f.idps.EXPECT().GetRevision(gomock.Any(), c.project, c.id).Return(&domain.IDPConnection{ID: "idp_of_revision"}, nil)
		},
	},
	{
		op: "GetIdpRevisionById", variant: "revision unknown", cookie: true, relation: viewer, target: onTarget,
		idField: "RevisionID", denied: idpCodes.denied, miss: idpCodes.readMiss,
		setup: func(_ *testing.T, f *gateFixture, c gateCall) {
			f.idps.EXPECT().GetRevision(gomock.Any(), c.project, c.id).Return(nil, domain.ErrIDPConnectionNotFound())
		},
	},

	// Invitations: every operation asks admin, like creating a grant.
	{op: "CreateInvitation", cookie: true, relation: admin, target: onProject, denied: invitationCodes.denied, miss: invitationCodes.readMiss},
	{op: "ListInvitations", cookie: true, relation: admin, target: onProject, denied: invitationCodes.denied, miss: invitationCodes.readMiss, open: openInvitationRead},
	{op: "GetInvitation", cookie: true, relation: admin, target: onProject, denied: invitationCodes.denied, miss: invitationCodes.readMiss, open: openInvitationRead},
	{op: "CancelInvitation", cookie: true, relation: admin, target: onProject, denied: invitationCodes.denied, miss: invitationCodes.readMiss},

	// Operation policies.
	{op: "ListPolicies", cookie: true, relation: viewer, target: onProject, list: true, miss: policyCodes.readMiss},
	{op: "PublishPolicy", relation: editor, target: onProject, denied: policyCodes.denied, miss: policyCodes.writeMiss},
	{op: "EvaluatePolicy", cookie: true, relation: viewer, target: onProject, denied: policyCodes.denied, miss: policyCodes.readMiss},
	{op: "GetPolicyRevision", cookie: true, relation: viewer, target: onProject, denied: policyCodes.denied, miss: policyCodes.readMiss},
	{op: "GetPolicy", cookie: true, relation: viewer, target: onResource, idField: "PolicyID", kind: domain.ResourceKindPolicy, denied: policyCodes.denied, miss: policyCodes.readMiss},
	{op: "ListPolicyRevisions", cookie: true, relation: viewer, target: onResource, idField: "PolicyID", kind: domain.ResourceKindPolicy, denied: policyCodes.denied, miss: policyCodes.readMiss},

	// Projects, their admins, claim and origins.
	{op: "QueryProjects", relation: viewer, target: onOwnProject, denied: projectCodes.denied, miss: projectCodes.readMiss},
	{op: "GetProject", cookie: true, relation: viewer, target: onProject, denied: projectCodes.denied, miss: projectCodes.readMiss},
	{op: "PatchProject", cookie: true, relation: editor, target: onProject, denied: projectCodes.denied, miss: projectCodes.writeMiss},
	{op: "ListProjectAdmins", cookie: true, relation: viewer, target: onProject, denied: projectCodes.denied, miss: projectCodes.readMiss},
	{op: "InitClaim", relation: editor, target: onProject, denied: projectCodes.denied, miss: projectCodes.writeMiss},
	{op: "GetClaimStatus", relation: viewer, target: onProject, denied: projectCodes.denied, miss: projectCodes.readMiss},
	{op: "AddOrigin", cookie: true, relation: editor, target: onProject, denied: originCodes.denied, miss: originCodes.writeMiss},
	{op: "RemoveOrigin", cookie: true, relation: admin, target: onProject, denied: originCodes.denied, miss: originCodes.readMiss},

	// Releases.
	{op: "ListReleases", cookie: true, relation: viewer, target: onProject, list: true, miss: releaseCodes.readMiss},
	{op: "CreateRelease", relation: editor, target: onProject, denied: releaseCodes.denied, miss: releaseCodes.writeMiss},
	{op: "BuildRelease", relation: editor, target: onProject, denied: releaseCodes.denied, miss: releaseCodes.writeMiss},
	{op: "GetReleaseById", cookie: true, relation: viewer, target: onProject, denied: releaseCodes.denied, miss: releaseCodes.readMiss},
	{op: "RevokeRelease", cookie: true, relation: editor, target: onProject, denied: releaseCodes.denied, miss: releaseCodes.writeMiss, open: openWriteIsNotDelete},

	// User schemas.
	{op: "ListSchemas", cookie: true, relation: viewer, target: onProject, list: true, miss: schemaCodes.readMiss},
	{op: "CreateSchema", relation: editor, target: onProject, denied: schemaCodes.denied, miss: schemaCodes.writeMiss},
	{op: "GetSchemaById", cookie: true, relation: viewer, target: onResource, idField: "ID", kind: domain.ResourceKindSchema, denied: schemaCodes.denied, miss: schemaCodes.readMiss},

	// Search answers for the project before it reads any type.
	{op: "Search", cookie: true, relation: viewer, target: onProject, list: true, miss: projectCodes.readMiss},

	// Sessions, as an operator manages them.
	{op: "QuerySessions", relation: viewer, target: onProject, denied: sessionCodes.denied, miss: sessionCodes.readMiss},
	{op: "GetSession", relation: viewer, target: onResource, idField: "SessionID", kind: domain.ResourceKindSession, denied: sessionCodes.denied, miss: sessionCodes.readMiss},
	{op: "RevokeSession", relation: admin, target: onResource, idField: "SessionID", kind: domain.ResourceKindSession, denied: sessionCodes.denied, miss: sessionCodes.readMiss},

	// Teams. A refused delete is team.permission_denied, whatever the Check
	// answered (requireTeamDelete).
	{op: "CreateTeam", cookie: true, relation: editor, target: onProject, denied: teamCodes.denied, miss: teamCodes.writeMiss},
	{op: "QueryTeams", cookie: true, relation: viewer, target: onProject, list: true, miss: teamCodes.readMiss},
	{op: "GetTeam", cookie: true, relation: viewer, target: onResource, idField: "TeamID", kind: domain.ResourceKindTeam, denied: teamCodes.denied, miss: teamCodes.readMiss},
	{op: "UpdateTeam", cookie: true, relation: editor, target: onResource, idField: "TeamID", kind: domain.ResourceKindTeam, denied: teamCodes.denied, miss: teamCodes.readMiss},
	{op: "DeleteTeam", relation: admin, target: onResource, idField: "TeamID", kind: domain.ResourceKindTeam, denied: teamCodes.denied, miss: teamCodes.denied},

	// Users.
	{op: "CreateUser", cookie: true, relation: editor, target: onProject, denied: userCodes.denied, miss: userCodes.writeMiss},
	{op: "QueryUsers", cookie: true, relation: viewer, target: onProject, list: true, miss: userCodes.readMiss},
	{op: "GetUserByID", cookie: true, relation: viewer, target: onResource, idField: "UserID", kind: domain.ResourceKindUser, denied: userCodes.denied, miss: userCodes.readMiss},
	{op: "PatchUserByID", cookie: true, relation: editor, target: onResource, idField: "UserID", kind: domain.ResourceKindUser, denied: userCodes.denied, miss: userCodes.readMiss},
	{op: "DeleteUserByID", cookie: true, relation: admin, target: onResource, idField: "UserID", kind: domain.ResourceKindUser, denied: userCodes.denied, miss: userCodes.readMiss},
	{op: "ListUserIdentityLinks", cookie: true, relation: viewer, target: onResource, idField: "UserID", kind: domain.ResourceKindUser, denied: userCodes.denied, miss: userCodes.readMiss},
	{op: "ListUserPasskeys", cookie: true, relation: viewer, target: onResource, idField: "UserID", kind: domain.ResourceKindUser, denied: userCodes.denied, miss: userCodes.readMiss},
	{op: "ListUserTeams", cookie: true, relation: viewer, target: onResource, idField: "UserID", kind: domain.ResourceKindUser, denied: userCodes.denied, miss: userCodes.readMiss},
	{op: "GetUserPasswordState", cookie: true, relation: viewer, target: onResource, idField: "UserID", kind: domain.ResourceKindUser, denied: userCodes.denied, miss: userCodes.readMiss},
	{op: "SetUserPassword", relation: editor, target: onResource, idField: "UserID", kind: domain.ResourceKindUser, denied: userCodes.denied, miss: userCodes.readMiss, open: openCredentialTier},
	{op: "BeginUserPasskeyRegistration", relation: editor, target: onResource, idField: "UserID", kind: domain.ResourceKindUser, denied: userCodes.denied, miss: userCodes.readMiss, open: openCredentialTier},
	{op: "FinishUserPasskeyRegistration", relation: editor, target: onResource, idField: "UserID", kind: domain.ResourceKindUser, denied: userCodes.denied, miss: userCodes.readMiss, open: openCredentialTier},

	// Variables and secrets. Deleting one asks editor on purpose
	// (variable.go): whoever may overwrite a value can already destroy it.
	{op: "GetVariables", cookie: true, relation: viewer, target: onProject, denied: variableCodes.denied, miss: variableCodes.readMiss},
	{op: "GetVariable", cookie: true, relation: viewer, target: onProject, denied: variableCodes.denied, miss: variableCodes.readMiss},
	{op: "UpdateVariables", relation: editor, target: onProject, denied: variableCodes.denied, miss: variableCodes.writeMiss},
	{op: "DeleteVariable", relation: editor, target: onProject, denied: variableCodes.denied, miss: variableCodes.writeMiss, open: openWriteIsNotDelete},
}

// ungatedOperations are the operations that ask no project gate, each with why.
var ungatedOperations = map[string]string{
	"GetLive":        "health probe, public",
	"GetReady":       "health probe, public",
	"CreateFlow":     "public: the login flow engine a browser drives before anyone signs in",
	"GetFlowStep":    "public: the login flow engine a browser drives before anyone signs in",
	"SubmitFlowStep": "public: the login flow engine a browser drives before anyone signs in",
	"CreateProject":  "anonymous bootstrap; the claim flow attaches an owner",
	"GetClaimWindow": "public: tells a claim link's holder whether it expired",
	"CompleteClaim":  "the claim challenge and the platform session are the credential (verifyClaimSession), not a grant",

	"CreateApplication":  "not implemented: answers 501",
	"GetApplicationById": "not implemented: answers 501",

	"CreateAuthAttempt":    "runtime plane: a project secret acts on its own project's attempts, no grant",
	"GetAuthAttempt":       "runtime plane: a project secret acts on its own project's attempts, no grant",
	"IssueChallenge":       "runtime plane: a project secret acts on its own project's attempts, no grant",
	"VerifyChallengeProof": "runtime plane: a project secret acts on its own project's attempts, no grant",
	"CreateHandoff":        "runtime plane: a project secret acts on its own project's attempts, no grant",
	"CreateSession":        "runtime plane: mints an anonymous session, no grant",
	"ExchangeHandoff":      "runtime plane: a project secret exchanges its own project's handoffs, no grant",

	"AcceptInvitation": "the invitation token is the credential",
	"LookupInvitation": "the invitation token is the credential",
	"RejectInvitation": "the invitation token is the credential",

	"GetMySession":          "self-service: the session cookie acts on itself",
	"GetMySessionCsrfToken": "self-service: the session cookie acts on itself",
	"RevokeMySession":       "self-service: the session cookie acts on itself",
	"GetMyUser":             "self-service: the session cookie acts on its own user",
	"PatchMyUser":           "self-service: the session cookie acts on its own user",
	"GetMyUserSchema":       "self-service: the session cookie acts on its own user",
	"GetMyPasswordState":    "self-service: the session cookie acts on its own user",
	"ListMyIdentityLinks":   "self-service: the session cookie acts on its own user",
	"ListMyPasskeys":        "self-service: the session cookie acts on its own user",
	"ListMyTeams":           "self-service: the session cookie acts on its own user",
	// It asks the resolver, but only the platform operator question, and a
	// "no" still lists the caller's own projects.
	"ListMyProjects": "asks only the platform operator question, pinned with its exact params by TestListMyProjects_PlatformOperator",
}

const (
	contractHome   = "proj_home"
	contractTarget = "proj_target"
	contractTeam   = "team_of_resource"
	contractPathID = "path_id"
)

// gateCall is what one run of a row puts in the request.
type gateCall struct {
	project string // the project_id the request names
	id      string // the path id
}

// gatePrincipal is a credential as the security handler mints it.
type gatePrincipal struct {
	name   string
	scheme string // the spec security scheme it arrives by
	scope  ScopeContext
}

// gatePrincipals: a Console session homed in one project, which can reach
// another, and a project secret, which is confined to its own project for
// path ids but may name another one (credentialCeiling).
var gatePrincipals = []gatePrincipal{
	{name: "session", scheme: "sessionCookie", scope: ScopeContext{
		ProjectID:     contractHome,
		PrincipalType: domain.AuthzPrincipalTypeUser,
		PrincipalID:   "user_alice",
	}},
	{name: "project secret", scheme: "oauth2", scope: ScopeContext{
		ProjectID:     contractHome,
		Scope:         []string{"project.write", "project.read"},
		PrincipalType: domain.AuthzPrincipalTypeSKProj,
		PrincipalID:   contractHome,
	}},
}

// recordingAuthzStmts answers the gate's statements, denying every Check, and
// records what each was asked. Every other statement goes to a gomock with no
// expectations, so a denied request that reaches storage fails the test.
type recordingAuthzStmts struct {
	*servicemocks.MockAllStatements
	foothold bool
	rsi      map[string]domain.ResourceScope

	mu        sync.Mutex
	checks    []domain.AuthzCheckParams
	operators []domain.AuthzPlatformCheckParams
}

func (s *recordingAuthzStmts) ActiveSystemCatalogID(context.Context) (string, error) {
	return domain.SystemCatalogID, nil
}

func (s *recordingAuthzStmts) CheckAuthz(_ context.Context, params domain.AuthzCheckParams) (bool, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.checks = append(s.checks, params)
	return false, s.foothold, nil
}

func (s *recordingAuthzStmts) CheckPlatformOperator(_ context.Context, params domain.AuthzPlatformCheckParams) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.operators = append(s.operators, params)
	return false, nil
}

func (s *recordingAuthzStmts) GetResourceScope(_ context.Context, resourceID string) (*domain.ResourceScope, error) {
	row, ok := s.rsi[resourceID]
	if !ok {
		return nil, new(database.NoRowFoundError)
	}
	return &row, nil
}

func (s *recordingAuthzStmts) GetResourceScopeInProject(ctx context.Context, kind domain.ResourceKind, projectID, resourceID string) (*domain.ResourceScope, error) {
	row, err := s.GetResourceScopeByIDInProject(ctx, projectID, resourceID)
	if err != nil {
		return nil, err
	}
	if row.ResourceKind != kind {
		return nil, new(database.NoRowFoundError)
	}
	return row, nil
}

func (s *recordingAuthzStmts) GetResourceScopeByIDInProject(ctx context.Context, projectID, resourceID string) (*domain.ResourceScope, error) {
	row, err := s.GetResourceScope(ctx, resourceID)
	if err != nil {
		return nil, err
	}
	if row.ProjectID != projectID {
		return nil, new(database.NoRowFoundError)
	}
	return row, nil
}

// gateFixture is a Handler over recordingAuthzStmts whose services are
// gomocks with no expectations, or real services over the same statements.
// The services with neither stay nil: reaching one panics.
type gateFixture struct {
	handler *Handler
	stmts   *recordingAuthzStmts
	idps    *servicemocks.MockIDPConnectionService
}

func newGateFixture(t *testing.T, foothold bool) *gateFixture {
	t.Helper()
	ctrl := gomock.NewController(t)
	stmts := &recordingAuthzStmts{
		MockAllStatements: servicemocks.NewMockAllStatements(ctrl),
		foothold:          foothold,
		rsi:               map[string]domain.ResourceScope{},
	}
	pool := servicemocks.NewMockPool(ctrl)
	pool.EXPECT().Statements().Return(stmts).AnyTimes()
	db := service.NewPool(pool)
	idps := servicemocks.NewMockIDPConnectionService(ctrl)
	variables := servicemocks.NewMockVariableService(ctrl)
	return &gateFixture{
		stmts: stmts,
		idps:  idps,
		handler: &Handler{
			pool:                 db,
			projectService:       servicemocks.NewMockProjectService(ctrl),
			sessionService:       servicemocks.NewMockSessionService(ctrl),
			releaseService:       servicemocks.NewMockReleaseService(ctrl),
			variableService:      variables,
			idpConnectionService: idps,
			claimService:         servicemocks.NewMockClaimService(ctrl),
			tokenService:         servicemocks.NewMockTokenService(ctrl),
			keyService:           servicemocks.NewMockKeyService(ctrl),
			teamService:          service.NewTeamService(db),
			brandingService:      service.NewBrandingService(db),
			eventService:         service.NewEventService(db, ""),
			grantService:         service.NewGrantService(db, nil, ""),
			policyService:        service.NewPolicyService(db, nil),
			deploymentService:    service.NewDeploymentService(db, variables),
		},
	}
}

// TestGateContract runs every row's operation, for every principal its spec
// lets in, against Checks that deny: once with a foothold (403) and once
// without (404), and asserts the one Check the gate asked and the answer.
func TestGateContract(t *testing.T) {
	t.Parallel()
	ops := bundledOperations(t)

	for _, row := range gateRows {
		spec, ok := ops[row.op]
		require.True(t, ok, "row %s names no operation in the spec", row.op)
		ran := false
		for _, p := range gatePrincipals {
			if !spec.schemes[p.scheme] {
				continue
			}
			ran = true
			for _, foothold := range []bool{true, false} {
				if foothold && row.list {
					// A foothold narrows a list (TestRequireProjectListAccess):
					// the request goes on to the service with a filter.
					continue
				}
				name := fmt.Sprintf("%s/%s/foothold=%t", rowName(row), p.name, foothold)
				t.Run(name, func(t *testing.T) {
					t.Parallel()
					runGateRow(t, row, p, foothold)
				})
			}
		}
		assert.True(t, ran, "%s: no principal of this test reaches it through the spec's security schemes", rowName(row))
	}
}

func runGateRow(t *testing.T, row gateRow, p gatePrincipal, foothold bool) {
	f := newGateFixture(t, foothold)

	// A project secret looks a path id up in its own project only, so its
	// by-id runs name that project; a session reaches the target one. Every
	// other run names the target project, which only the Check may refuse.
	call := gateCall{project: contractTarget, id: contractPathID}
	if row.target == onResource && p.scope.PrincipalType != domain.AuthzPrincipalTypeUser {
		call.project = p.scope.ProjectID
	}
	want := domain.AuthzCheckParams{
		CatalogID:              domain.SystemCatalogID,
		ProjectID:              call.project,
		PrincipalHomeProjectID: p.scope.ProjectID,
		PrincipalType:          p.scope.PrincipalType,
		PrincipalID:            p.scope.PrincipalID,
		ObjectType:             "project",
		Relation:               row.relation,
	}
	switch row.target {
	case onOwnProject:
		want.ProjectID = p.scope.ProjectID
	case onResource:
		rsiID := row.rsiID
		if rsiID == "" {
			rsiID = call.id
		}
		f.stmts.rsi[rsiID] = domain.ResourceScope{
			ResourceID:   rsiID,
			ResourceKind: row.kind,
			ProjectID:    call.project,
			TeamID:       new(contractTeam),
		}
		want.ResourceID = rsiID
		want.ResourceTeamID = contractTeam
	case onTarget:
		want.ResourceID = call.id
	}
	if row.setup != nil {
		row.setup(t, f, call)
	}

	err := callOperation(t, f.handler, row, p.scope, call)

	f.stmts.mu.Lock()
	defer f.stmts.mu.Unlock()
	require.Len(t, f.stmts.checks, 1, "the gate asks one Check before it refuses")
	assert.Equal(t, want, f.stmts.checks[0], "the Check the gate asked")
	assert.Empty(t, f.stmts.operators, "a principal outside the platform project is never asked the operator question")
	wantCode := row.miss
	if foothold {
		wantCode = row.denied
	}
	assertDomainCode(t, err, wantCode)
}

// callOperation calls the row's operation on h by name, with a zero request
// body and params whose project_id and path id carry the call.
func callOperation(t *testing.T, h *Handler, row gateRow, scope ScopeContext, call gateCall) error {
	t.Helper()
	ctx := WithScopeContext(t.Context(), scope)
	method := reflect.ValueOf(h).MethodByName(row.op)
	require.True(t, method.IsValid(), "Handler has no method %s", row.op)
	mt := method.Type()
	require.GreaterOrEqual(t, mt.NumIn(), 1)
	require.Equal(t, reflect.TypeFor[context.Context](), mt.In(0), "%s takes a context first", row.op)

	args := []reflect.Value{reflect.ValueOf(ctx)}
	var setProject, setID bool
	for i := 1; i < mt.NumIn(); i++ {
		arg, struc := zeroArg(mt.In(i))
		if struc.IsValid() {
			setProject = setStringField(struc, "ProjectID", call.project) || setProject
			if row.idField != "" {
				setID = setStringField(struc, row.idField, call.id) || setID
			}
		}
		args = append(args, arg)
	}
	if row.target == onProject || row.target == onTarget {
		require.True(t, setProject, "%s: no ProjectID field to name the project in", row.op)
	}
	if row.idField != "" {
		require.True(t, setID, "%s: no %s field to carry the path id", row.op, row.idField)
	}

	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("%s reached an unwired service after its gate refused: %v", row.op, r)
		}
	}()
	out := method.Call(args)
	if last := out[len(out)-1]; !last.IsNil() {
		return last.Interface().(error)
	}
	return nil
}

// zeroArg is a zero value of t, allocated if t is a pointer, and the struct it
// holds, if any, so its fields can be set.
func zeroArg(t reflect.Type) (arg, struc reflect.Value) {
	if t.Kind() == reflect.Pointer {
		arg = reflect.New(t.Elem())
		if t.Elem().Kind() == reflect.Struct {
			struc = arg.Elem()
		}
		return arg, struc
	}
	arg = reflect.New(t).Elem()
	if t.Kind() == reflect.Struct {
		struc = arg
	}
	return arg, struc
}

// setStringField sets a string-kinded field, or an ogen optional (Value and
// Set) of one, and reports whether s has it.
func setStringField(s reflect.Value, name, value string) bool {
	field := s.FieldByName(name)
	if !field.IsValid() {
		return false
	}
	if field.Kind() == reflect.String {
		field.SetString(value)
		return true
	}
	if field.Kind() == reflect.Struct {
		v, set := field.FieldByName("Value"), field.FieldByName("Set")
		if v.IsValid() && v.Kind() == reflect.String && set.IsValid() && set.Kind() == reflect.Bool {
			v.SetString(value)
			set.SetBool(true)
			return true
		}
	}
	return false
}

func rowName(row gateRow) string {
	if row.variant == "" {
		return row.op
	}
	return row.op + "/" + row.variant
}

// TestGateContractCoversEveryOperation fails when the spec gains an
// operation with neither a gate row nor a reason it is ungated, or when a row
// or a reason outlives its operation. It also pins the plane: whether each
// gated operation accepts the Console session cookie.
func TestGateContractCoversEveryOperation(t *testing.T) {
	t.Parallel()
	ops := bundledOperations(t)
	handler := reflect.TypeFor[api.Handler]()

	rows := map[string]bool{}
	seen := map[string]bool{}
	for _, row := range gateRows {
		key := rowName(row)
		assert.False(t, seen[key], "duplicate gate row %s", key)
		seen[key] = true
		rows[row.op] = true
		_, ungated := ungatedOperations[row.op]
		assert.False(t, ungated, "%s has a gate row and an ungated reason", row.op)
		assert.NotEmpty(t, row.relation, "%s: no relation", key)
		assert.NotEmpty(t, row.miss, "%s: no miss code", key)
		if !row.list {
			assert.NotEmpty(t, row.denied, "%s: no denied code", key)
		}
		if row.target == onResource {
			assert.NotEmpty(t, row.kind, "%s: a by-id gate needs the index kind", key)
		}
		spec, ok := ops[row.op]
		if !assert.True(t, ok, "gate row %s names no operation in the spec", key) {
			continue
		}
		assert.Equal(t, spec.schemes["sessionCookie"], row.cookie,
			"%s %s: the row and the spec disagree on whether the Console session cookie may call it; change the plane deliberately and the row with it", spec.method, spec.path)
	}
	for op, reason := range ungatedOperations {
		assert.NotEmpty(t, reason, "%s: an ungated operation needs its reason", op)
		_, ok := ops[op]
		assert.True(t, ok, "ungated reason for %s names no operation in the spec", op)
	}
	for op, spec := range ops {
		_, ungated := ungatedOperations[op]
		assert.True(t, rows[op] || ungated,
			"%s %s (%s) has no gate row and no ungated reason: add it to gateRows, or to ungatedOperations with why it asks no gate", spec.method, spec.path, op)
		_, ok := handler.MethodByName(op)
		assert.True(t, ok, "%s is not a method of the generated Handler: the operation name rule changed", op)
	}
}

// credentialTierOperations set or add a credential of another user.
// A platform-project editor who could call one with the Console cookie could
// replace a platform operator's credential and sign in as the operator,
// the escalation ADR 053 §9 forbids. They ask editor today (openCredentialTier),
// so only the bearer-only plane stops that.
var credentialTierOperations = []string{
	"SetUserPassword",
	"BeginUserPasskeyRegistration",
	"FinishUserPasskeyRegistration",
}

// credentialTierPath matches a management route that writes another user's
// sign-in factor, the shape a future factor reset would take.
var credentialTierPath = regexp.MustCompile(`^/users/\{user_id\}/(password|passkeys|totp|otp|recovery_codes|factors|mfa)(/|$)`)

// TestCredentialTierOperationsRefuseTheSessionCookie keeps the Console cookie
// off every credential-tier operation. Before one accepts it, it must ask
// admin and refuse a platform operator as its target; change this test with
// that decision, not before.
func TestCredentialTierOperationsRefuseTheSessionCookie(t *testing.T) {
	t.Parallel()
	ops := bundledOperations(t)

	for _, op := range credentialTierOperations {
		spec, ok := ops[op]
		if !assert.True(t, ok, "credential-tier operation %s is not in the spec", op) {
			continue
		}
		assert.False(t, spec.schemes["sessionCookie"],
			"%s %s accepts the Console session cookie: a platform-project editor could take over an operator account", spec.method, spec.path)
	}
	for op, spec := range ops {
		if spec.method == "GET" || !credentialTierPath.MatchString(spec.path) {
			continue
		}
		assert.True(t, slices.Contains(credentialTierOperations, op),
			"%s %s (%s) writes another user's sign-in factor: list it in credentialTierOperations", spec.method, spec.path, op)
	}
}

// specOperation is one operation of the bundled spec.
type specOperation struct {
	method, path string
	// schemes are the security schemes any of its requirements names; none
	// for a public operation.
	schemes map[string]bool
}

var bundledOperationsOnce = sync.OnceValues(func() (map[string]specOperation, error) {
	var doc struct {
		Paths map[string]map[string]json.RawMessage `json:"paths"`
	}
	if err := json.NewDecoder(openapibundled.Reader()).Decode(&doc); err != nil {
		return nil, err
	}
	ops := map[string]specOperation{}
	for path, item := range doc.Paths {
		for method, raw := range item {
			switch method {
			case "get", "put", "post", "delete", "patch", "head", "options", "trace":
			default:
				continue // parameters and the like
			}
			var op struct {
				OperationID string                `json:"operationId"`
				Security    []map[string][]string `json:"security"`
			}
			if err := json.Unmarshal(raw, &op); err != nil {
				return nil, fmt.Errorf("%s %s: %w", method, path, err)
			}
			if op.OperationID == "" {
				return nil, fmt.Errorf("%s %s has no operationId", method, path)
			}
			// ogen names an operation after its operationId, capitalized.
			name := strings.ToUpper(op.OperationID[:1]) + op.OperationID[1:]
			if _, dup := ops[name]; dup {
				return nil, fmt.Errorf("operation %s appears twice", name)
			}
			schemes := map[string]bool{}
			for _, requirement := range op.Security {
				for scheme := range requirement {
					schemes[scheme] = true
				}
			}
			ops[name] = specOperation{method: strings.ToUpper(method), path: path, schemes: schemes}
		}
	}
	return ops, nil
})

func bundledOperations(t *testing.T) map[string]specOperation {
	t.Helper()
	ops, err := bundledOperationsOnce()
	require.NoError(t, err)
	return ops
}
