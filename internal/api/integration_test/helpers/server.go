package helpers

import (
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	generated "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api"
	"github.com/zitadel/nextgen/internal/api/integration_test/test_data"
	"github.com/zitadel/nextgen/internal/cookie"
)

func (h *Harness) EnsureTestServer(t *testing.T) *httptest.Server {
	t.Helper()
	if h.TestServer == nil {
		h.TestServer = httptest.NewServer(
			h.EnsureGeneratedServer(t),
		)
		h.Schemas = test_data.BuildSchemas(h.TestServer.URL)
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
			h.EnsureSealer(t),
			h.EnsureFlowService(t),
			h.EnsureAuthAttemptService(t),
			h.EnsureSessionService(t),
			h.EnsureProjectService(t),
			h.EnsureSchemaService(t),
			h.EnsureFlowDefinitionService(t),
			time.Now,
		)
	}
	return h.Handler
}

// testSealerKey is a deterministic cookie sealer key for integration tests.
var testSealerKey = cookie.Key{
	0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
	0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f,
	0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17,
	0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f,
}

func (h *Harness) EnsureSealer(t *testing.T) *cookie.Sealer {
	t.Helper()
	if h.Sealer == nil {
		sealer, err := cookie.NewSealer(testSealerKey)
		require.NoError(t, err)
		h.Sealer = sealer
	}
	return h.Sealer
}

func (h *Harness) EnsureSecurityHandler(t *testing.T) *api.SecurityHandler {
	t.Helper()
	if h.SecurityHandler == nil {
		h.SecurityHandler = api.NewSecurityHandler()
	}
	return h.SecurityHandler
}
