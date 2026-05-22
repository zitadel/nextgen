//go:build integration

package helpers

import (
	"net/http"
	"net/http/httptest"

	generated "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api"
	"github.com/zitadel/nextgen/internal/api/integration_test/test_data"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

type Harness struct {
	DBPool     database.Pool
	HttpClient *http.Client
	TestServer *httptest.Server

	GeneratedServer *generated.Server
	Handler         *api.Handler
	SecurityHandler *api.SecurityHandler

	APIClient          *generated.Client
	FakeSecuritySource *FakeSecuritySource

	SchemaService      *service.SchemaService
	FlowService        service.FlowService
	AuthAttemptService service.AuthAttemptService

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

	Schemas test_data.Schemas
}
