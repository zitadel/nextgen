//go:build postgres_integration || spanner_integration || sqlite_integration

package helpers

import (
	"testing"

	"github.com/zitadel/nextgen/internal/secrets"
	"github.com/zitadel/nextgen/internal/service"
)

func (h *Harness) EnsureApplicationService(t testing.TB) service.ApplicationService {
	t.Helper()
	h.applicationService.mutex.Lock()
	defer h.applicationService.mutex.Unlock()

	if h.applicationService.value == nil {
		h.applicationService.value = service.NewApplicationService(
			h.EnsureServiceDB(t),
			h.EnsureSchemaValidator(t),
			secrets.NewRandomSecretGenerator(),
		)
	}
	return h.applicationService.value
}
