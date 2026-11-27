package service

import (
	"net/http"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/flowengine"
)

// FlowEngineDeps are the services the flow engine's collaborators are built from.
type FlowEngineDeps struct {
	DB *DB
	// Schemas resolves the schemas the engine renders and validates against.
	Schemas domain.SchemaResolver
	// SchemaStore is the store the collaborators create and resolve users with.
	SchemaStore    domain.JSONSchemaStore
	AuthAttempts   AuthAttemptService
	Users          UserService
	IDPConnections IDPConnectionService
	Keys           KeyService
	Variables      VariableService
	Hashers        ProjectHasherResolver
	Passwords      *PasswordPolicy
	Protection     SignupProtection
	// HTTPClient makes the IdP calls of an SSO redirect.
	HTTPClient *http.Client
}

// NewFlowEngine builds the flow engine with the collaborators the service provides.
func NewFlowEngine(deps FlowEngineDeps) *flowengine.Runtime {
	return flowengine.New(flowengine.Deps{
		Schemas: deps.Schemas,
		// The raw statements: the engine only hands this store to the
		// resolver, which follows the namespace itself, so the aliasing wrapper
		// would only double the reads of a miss.
		SchemaStore: deps.DB.Statements(),
		Fields:      domain.NewSchemaFieldResolver(),
		CreateUser: NewFlowCreateUserHandler(
			deps.Hashers,
			deps.Passwords,
			deps.Users,
			deps.SchemaStore,
			deps.DB,
			deps.Protection),
		AuthAttempts:  NewFlowAuthAttempts(deps.AuthAttempts, deps.DB, deps.SchemaStore, deps.Protection),
		SSOProviders:  NewFlowSSOProviderResolver(deps.IDPConnections),
		SSOIdentities: NewFlowSSOIdentityResolver(deps.DB, deps.IDPConnections, deps.Users, deps.SchemaStore, deps.Hashers, deps.Passwords),
		SSORedirects:  NewFlowSSORedirectIssuer(deps.IDPConnections, deps.AuthAttempts, deps.Keys, deps.Variables, deps.HTTPClient),
		Passwords:     deps.Passwords,
	})
}
