package helpers

import (
	"net"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
	generated "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api"
)

const TestServerAddress = "127.0.0.1:8081"

func (h *Harness) EnsureTestListener(t *testing.T) net.Listener {
	t.Helper()
	if h.testListener == nil {
		var err error
		h.testListener, err = net.Listen("tcp", TestServerAddress)
		require.NoError(t, err)
	}
	return h.testListener
}

func (h *Harness) EnsureTestServer(t *testing.T) *httptest.Server {
	t.Helper()
	if h.TestServer == nil {
		srv := httptest.NewUnstartedServer(h.EnsureGeneratedServer(t))

		// replace the default listener so that we can specify the exact address to which is listened. This is needed
		// for the schema resolver. It requires a `BuiltinSchemaBase`.
		err := srv.Listener.Close()
		require.NoError(t, err)

		srv.Listener = h.EnsureTestListener(t)
		srv.Start()
		h.TestServer = srv
	}
	return h.TestServer
}

func (h *Harness) EnsureGeneratedServer(t *testing.T) *generated.Server {
	t.Helper()
	if h.GeneratedServer == nil {
		var err error
		h.GeneratedServer, err = generated.NewServer(
			h.EnsureHandler(t),
			h.EnsureSecurityHandler(t),
			generated.WithErrorHandler(api.OgenErrorHandler),
		)
		require.NoError(t, err)
	}
	return h.GeneratedServer
}

func (h *Harness) EnsureHandler(t *testing.T) *api.Handler {
	t.Helper()
	if h.Handler == nil {
		h.Handler = api.NewHandler(
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
	}
	return h.Handler
}

func (h *Harness) EnsureSecurityHandler(t *testing.T) *api.SecurityHandler {
	t.Helper()
	if h.SecurityHandler == nil {
		h.SecurityHandler = api.NewSecurityHandler()
	}
	return h.SecurityHandler
}
