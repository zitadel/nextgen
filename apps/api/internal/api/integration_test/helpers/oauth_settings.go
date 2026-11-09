//go:build postgres_integration || spanner_integration || sqlite_integration

package helpers

import (
	"testing"

	"github.com/zitadel/nextgen/internal/service"
)

func (h *Harness) EnsureOAuthSettingsService(t testing.TB) *service.OAuthSettingsService {
	t.Helper()
	h.oauthSettingsService.mutex.Lock()
	defer h.oauthSettingsService.mutex.Unlock()

	if h.oauthSettingsService.value == nil {
		h.oauthSettingsService.value = service.NewOAuthSettingsService(h.EnsureServiceDB(t))
	}
	return h.oauthSettingsService.value
}
