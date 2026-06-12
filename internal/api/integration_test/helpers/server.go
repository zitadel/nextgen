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
	h.mu.Lock()
	server := h.TestServer
	h.mu.Unlock()
	if server != nil {
		return server
	}
	server = httptest.NewServer(
		h.EnsureGeneratedServer(t),
	)
	h.mu.Lock()
	if h.TestServer == nil {
		h.TestServer = server
	}
	server = h.TestServer
	h.mu.Unlock()
	return server
}

func (h *Harness) EnsureGeneratedServer(t *testing.T) *generated.Server {
	t.Helper()
	h.mu.Lock()
	server := h.GeneratedServer
	h.mu.Unlock()
	if server != nil {
		return server
	}
	server, err := generated.NewServer(
		h.EnsureHandler(t),
		h.EnsureSecurityHandler(t),
		generated.WithErrorHandler(api.OgenErrorHandler),
	)
	require.NoError(t, err)
	h.mu.Lock()
	if h.GeneratedServer == nil {
		h.GeneratedServer = server
	}
	server = h.GeneratedServer
	h.mu.Unlock()
	return server
}

func (h *Harness) EnsureHandler(t *testing.T) *api.Handler {
	t.Helper()
	h.mu.Lock()
	handler := h.Handler
	h.mu.Unlock()
	if handler != nil {
		return handler
	}
	handler = api.NewHandler(
		h.EnsureCrypter(t),
		h.EnsureFlowService(t),
		h.EnsureAuthAttemptService(t),
		h.EnsureSessionService(t),
		h.EnsureProjectService(t),
		h.EnsureUserService(t),
		h.EnsureSchemaService(t),
		h.EnsureFlowDefinitionService(t),
		h.EnsureTeamService(t),
	)
	h.mu.Lock()
	if h.Handler == nil {
		h.Handler = handler
	}
	handler = h.Handler
	h.mu.Unlock()
	return handler
}

func (h *Harness) EnsureSecurityHandler(t *testing.T) *api.SecurityHandler {
	t.Helper()
	h.mu.Lock()
	handler := h.SecurityHandler
	h.mu.Unlock()
	if handler != nil {
		return handler
	}
	handler = api.NewSecurityHandler()
	h.mu.Lock()
	if h.SecurityHandler == nil {
		h.SecurityHandler = handler
	}
	handler = h.SecurityHandler
	h.mu.Unlock()
	return handler
}
