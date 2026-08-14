package helpers

import (
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
	generated "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api"
)

func (h *Harness) EnsureTestServer(t *testing.T) *httptest.Server {
	t.Helper()
	h.testServer.mutex.Lock()
	defer h.testServer.mutex.Unlock()

	if h.testServer.value == nil {
		h.testServer.value = httptest.NewServer(
			api.WithSessionStateNoStore(h.EnsureGeneratedServer(t)),
		)
	}
	return h.testServer.value
}

func (h *Harness) EnsureGeneratedServer(t *testing.T) *generated.Server {
	t.Helper()
	h.generatedServer.mutex.Lock()
	defer h.generatedServer.mutex.Unlock()

	if h.generatedServer.value == nil {
		var err error
		h.generatedServer.value, err = generated.NewServer(
			h.EnsureHandler(t),
			h.EnsureSecurityHandler(t),
			generated.WithErrorHandler(api.OgenErrorHandler),
		)
		require.NoError(t, err)
	}
	return h.generatedServer.value
}

func (h *Harness) EnsureHandler(t *testing.T) *api.Handler {
	t.Helper()
	h.handler.mutex.Lock()
	defer h.handler.mutex.Unlock()

	if h.handler.value == nil {
		h.handler.value = api.NewHandler(
			h.EnsureFlowService(t),
			h.EnsureAuthAttemptService(t),
			h.EnsureSessionService(t),
			h.EnsureProjectService(t),
			h.EnsureUserService(t),
			h.EnsureSchemaService(t),
			h.EnsureFlowDefinitionService(t),
			h.EnsureTeamService(t),
			h.EnsureBrandingService(t),
			h.EnsureEventService(t),
			h.EnsureTokenService(t),
			h.EnsureKeyService(t),
			h.EnsureServiceDB(t),
			"",
		)
	}
	return h.handler.value
}

func (h *Harness) EnsureSecurityHandler(t *testing.T) *api.SecurityHandler {
	t.Helper()
	h.securityHandler.mutex.Lock()
	defer h.securityHandler.mutex.Unlock()

	if h.securityHandler.value == nil {
		h.securityHandler.value = api.NewSecurityHandler(
			h.EnsureTokenService(t),
		)
	}
	return h.securityHandler.value
}
