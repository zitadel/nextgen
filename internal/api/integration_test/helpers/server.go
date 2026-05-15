//go:build integration

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
	if h.TestServer == nil {
		h.TestServer = httptest.NewServer(
			h.EnsureGeneratedServer(t),
		)
		t.Cleanup(h.TestServer.Close)
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
		)
		require.NoError(t, err)
	}
	return h.GeneratedServer
}

func (h *Harness) EnsureHandler(t *testing.T) *api.Handler {
	t.Helper()
	if h.Handler == nil {
		h.Handler = api.NewHandler(
			h.EnsureSchemaService(t),
			h.EnsureFlowService(t),
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
