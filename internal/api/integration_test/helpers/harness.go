package helpers

import (
	"crypto/rsa"
	"net/http"
	"net/http/httptest"

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
	EncryptionKey []byte
	SigningKey    *rsa.PrivateKey

	DBPool          database.Pool
	DB              *service.DB
	HttpClient      *http.Client
	TestServer      *httptest.Server
	Hasher          *crypto.PasswapHasher
	Crypter         crypto.Crypter
	SecretGenerator secrets.Generator
	JoseSigner      jose.Signer

	GeneratedServer *generated.Server
	Handler         *api.Handler
	SecurityHandler *api.SecurityHandler

	SchemaService         *service.SchemaService
	SessionService        service.SessionService
	FlowService           service.FlowService
	AuthAttemptService    service.AuthAttemptService
	ProjectService        service.ProjectService
	FlowDefinitionService service.FlowDefinitionService
	UserService           *service.UserService
	FlowStateMachine      *domain.FlowStateMachineRuntime
	TeamService           *service.TeamService
	BrandingService       *service.BrandingService
	KeyService            service.KeyService
	TokenService          service.TokenService

	SchemaStore        domain.JSONSchemaStore
	SchemaResolver     *domain.JSONSchemaResolver
	SchemaValidator    *domain.SchemaValidator
	FlowDefinitionRepo domain.FlowDefinitionRepository
	AuthAttemptRepo    domain.AuthAttemptRepository
	SessionRepo        domain.SessionRepository
	UserRepo           domain.UserRepository
	UserPasswordRepo   domain.UserPasswordRepository
	UserPasskeyRepo    domain.UserPasskeyRepository
	TeamRepo           domain.TeamRepository
	BrandingRepo       domain.BrandingRepository

	TestData test_data.TestData
}
