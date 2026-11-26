//go:build postgres_integration || spanner_integration || sqlite_integration

package helpers

import (
	"testing"

	"github.com/zitadel/nextgen/internal/service"
)

func (h *Harness) EnsureFlowService(t testing.TB) service.FlowService {
	t.Helper()
	h.flowService.mutex.Lock()
	defer h.flowService.mutex.Unlock()

	if h.flowService.value == nil {
		// The engine and the service share one sign-up guard, as in the server.
		protection := service.NewSignupProtection(h.EnsureServiceDB(t), h.EnsureKeyService(t), h.EnsureUserCreatePolicy(t))
		engine := service.NewFlowEngine(service.FlowEngineDeps{
			DB:             h.EnsureServiceDB(t),
			Schemas:        h.EnsureSchemaResolver(t),
			SchemaStore:    h.EnsureSchemaStore(t),
			AuthAttempts:   h.EnsureAuthAttemptService(t),
			Users:          h.EnsureUserService(t),
			IDPConnections: h.EnsureIDPConnectionService(t),
			Keys:           h.EnsureKeyService(t),
			Variables:      h.EnsureVariableService(t),
			Hashers:        h.EnsureProjectHashers(t),
			Passwords:      h.EnsurePasswordPolicy(t),
			Protection:     protection,
			HTTPClient:     h.EnsureHttpClient(t),
		})
		h.flowService.value = service.NewFlowService(
			h.EnsureServiceDB(t),
			engine,
			BuiltinSchemaBases(),
			protection)
	}
	return h.flowService.value
}
