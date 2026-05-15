//go:build integration

package helpers

import (
	"net/http"
	"net/http/httptest"

	generated "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api"
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

	SchemaService *service.SchemaService
	FlowService   service.FlowService

	SchemaRepo         domain.JSONSchemaRepository
	SchemaResolver     *domain.JSONSchemaResolver
	FlowDefinitionRepo domain.FlowDefinitionRepository

	Project *domain.Project
}
