package helpers

import (
	"crypto/rsa"
	"net/http"
	"net/http/httptest"
	"sync"

	"github.com/go-jose/go-jose/v4"
	generated "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api"
	"github.com/zitadel/nextgen/internal/api/integration_test/test_data"
	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/secrets"
	"github.com/zitadel/nextgen/internal/service"
)

type Harness struct {
	signingKey dependency[*rsa.PrivateKey]

	DB *service.DB

	httpClient      dependency[*http.Client]
	testServer      dependency[*httptest.Server]
	hasher          dependency[*crypto.PasswapHasher]
	masterKeys      dependency[*domain.MasterKeys]
	secretGenerator dependency[secrets.Generator]
	joseSigner      dependency[jose.Signer]

	generatedServer dependency[*generated.Server]
	handler         dependency[*api.Handler]
	securityHandler dependency[*api.SecurityHandler]

	platformProject dependency[*domain.Project]

	schemaService         dependency[*service.SchemaService]
	sessionService        dependency[service.SessionService]
	flowService           dependency[service.FlowService]
	authAttemptService    dependency[service.AuthAttemptService]
	projectService        dependency[service.ProjectService]
	flowDefinitionService dependency[service.FlowDefinitionService]
	userService           dependency[service.UserService]
	flowStateMachine      dependency[*domain.FlowStateMachineRuntime]
	teamService           dependency[*service.TeamService]
	brandingService       dependency[*service.BrandingService]
	environmentService    dependency[*service.EnvironmentService]
	releaseService        dependency[service.ReleaseService]
	eventService          dependency[*service.EventService]
	keyService            dependency[service.KeyService]
	tokenService          dependency[service.TokenService]

	schemaStore     dependency[domain.JSONSchemaStore]
	schemaResolver  dependency[*domain.JSONSchemaResolver]
	schemaValidator dependency[*domain.SchemaValidator]

	testData dependency[*test_data.TestData]
}

type dependency[T any] struct {
	mutex sync.Mutex
	value T
}

func (d *dependency[T]) Get() T {
	return d.value
}
