package helpers

import (
	"net/http"
	"net/http/httptest"

	generated "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api"
	"github.com/zitadel/nextgen/internal/api/integration_test/test_data"
	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

type Harness struct {
	DBPool     database.Pool
	HttpClient *http.Client
	TestServer *httptest.Server
	Hasher     *crypto.PasswapHasher
	Crypter    crypto.Crypter

	GeneratedServer *generated.Server
	Handler         *api.Handler
	SecurityHandler *api.SecurityHandler

	// apiClients is a map of API clients, keyed by project ID.
	// This allows tests to have multiple clients with different credentials if needed.
	// Use [harness.EnsureAPIClient] to get a client for a specific project ID, which will create and cache the client as needed.
	apiClients         map[string]*generated.Client
	FakeSecuritySource *FakeSecuritySource

	SchemaService         *service.SchemaService
	SessionService        service.SessionService
	FlowService           service.FlowService
	AuthAttemptService    service.AuthAttemptService
	ProjectService        service.ProjectService
	FlowDefinitionService service.FlowDefinitionService
	FlowStateMachine      *domain.FlowStateMachineRuntime
	TeamService           *service.TeamService

	SchemaRepo         domain.JSONSchemaRepository
	SchemaResolver     *domain.JSONSchemaResolver
	SchemaValidator    *domain.SchemaValidator
	FlowDefinitionRepo domain.FlowDefinitionRepository
	AuthAttemptRepo    domain.AuthAttemptRepository
	SessionRepo        domain.SessionRepository
	ProjectRepo        domain.ProjectRepository
	UserRepo           domain.UserRepository
	UserPasswordRepo   domain.UserPasswordRepository
	UserPasskeyRepo    domain.UserPasskeyRepository
	TeamRepo           domain.TeamRepository

	Schemas test_data.Schemas
}
