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
	"github.com/zitadel/nextgen/internal/storage/database"
)

type Harness struct {
	encryptionKey dependency[[]byte]
	signingKey    dependency[*rsa.PrivateKey]

	dBPool          dependency[database.Pool]
	dB              dependency[*service.DB]
	httpClient      dependency[*http.Client]
	testServer      dependency[*httptest.Server]
	hasher          dependency[*crypto.PasswapHasher]
	rootKEKs        dependency[*domain.RootKEKs]
	secretGenerator dependency[secrets.Generator]
	joseSigner      dependency[jose.Signer]

	generatedServer dependency[*generated.Server]
	handler         dependency[*api.Handler]
	securityHandler dependency[*api.SecurityHandler]

	schemaService         dependency[*service.SchemaService]
	sessionService        dependency[service.SessionService]
	flowService           dependency[service.FlowService]
	authAttemptService    dependency[service.AuthAttemptService]
	projectService        dependency[service.ProjectService]
	flowDefinitionService dependency[service.FlowDefinitionService]
	userService           dependency[*service.UserService]
	flowStateMachine      dependency[*domain.FlowStateMachineRuntime]
	teamService           dependency[*service.TeamService]
	brandingService       dependency[*service.BrandingService]
	keyService            dependency[service.KeyService]
	tokenService          dependency[service.TokenService]

	schemaStore      dependency[domain.JSONSchemaStore]
	schemaResolver   dependency[*domain.JSONSchemaResolver]
	schemaValidator  dependency[*domain.SchemaValidator]
	userRepo         dependency[domain.UserRepository]
	userPasswordRepo dependency[domain.UserPasswordRepository]
	userPasskeyRepo  dependency[domain.UserPasskeyRepository]
	brandingRepo     dependency[domain.BrandingRepository]

	testData dependency[*test_data.TestData]
}

type dependency[T any] struct {
	mutex sync.Mutex
	value T
}

func (d *dependency[T]) Get() T {
	return d.value
}
