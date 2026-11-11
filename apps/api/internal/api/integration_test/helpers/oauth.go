//go:build postgres_integration || spanner_integration || sqlite_integration

package helpers

import (
	"net/url"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/oauth"
	"github.com/zitadel/nextgen/internal/service"
)

// EnsureRuntimeResolver is the resolver the handler and the OAuth server
// share: the console's origin is ConsoleOrigin, as server.public_base would
// name it.
func (h *Harness) EnsureRuntimeResolver(t testing.TB) *service.RuntimeResolver {
	t.Helper()
	h.runtimeResolver.mutex.Lock()
	defer h.runtimeResolver.mutex.Unlock()

	if h.runtimeResolver.value == nil {
		h.runtimeResolver.value = service.NewRuntimeResolver(h.EnsureServiceDB(t), h.EnsureReleaseService(t), ConsoleOrigin)
	}
	return h.runtimeResolver.value
}

// EnsureOAuthHandlers builds the OAuth server the way cmd/server does with
// oauth.enabled and a platform project: ConsoleOrigin is the public base,
// so the platform issuer is ConsoleOrigin + "/oauth", and the admission and
// settings read the same projects and deployments the API writes.
func (h *Harness) EnsureOAuthHandlers(t testing.TB) *oauth.Handlers {
	t.Helper()
	h.oauthHandlers.mutex.Lock()
	defer h.oauthHandlers.mutex.Unlock()

	if h.oauthHandlers.value == nil {
		publicBase, err := url.Parse(ConsoleOrigin)
		require.NoError(t, err)
		h.oauthHandlers.value = oauth.New(oauth.Config{
			PublicBase:      publicBase,
			PlatformEnabled: true,
			Admission:       oauth.NewProjectAdmission(h.ensureProjectService(t), []string{ConsoleOrigin}),
			Settings:        oauth.NewReleaseSettings(h.EnsureRuntimeResolver(t), h.EnsureOAuthSettingsService(t)),
		})
	}
	return h.oauthHandlers.value
}
