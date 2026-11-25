//go:build postgres_integration || spanner_integration || sqlite_integration

package helpers

import (
	"testing"
	"time"

	"github.com/zitadel/nextgen/internal/flowengine"
	"github.com/zitadel/nextgen/internal/service"
)

// newSignupProtection builds the sign-up guard the flow engine's parts share
// in the server; it keeps no state of its own beyond the database.
func (h *Harness) newSignupProtection(t testing.TB) service.SignupProtection {
	t.Helper()
	return service.NewSignupProtection(h.EnsureServiceDB(t), h.EnsureKeyService(t), h.EnsureUserCreatePolicy(t))
}

func (h *Harness) EnsureFlowService(t testing.TB) service.FlowService {
	t.Helper()
	h.flowService.mutex.Lock()
	defer h.flowService.mutex.Unlock()

	if h.flowService.value == nil {
		h.flowService.value = service.NewFlowService(
			h.EnsureServiceDB(t),
			h.EnsureFlowStateMachine(t),
			BuiltinSchemaBases(),
			h.newSignupProtection(t))
	}
	return h.flowService.value
}

func (h *Harness) EnsureFlowStateMachine(t testing.TB) *flowengine.Runtime {
	t.Helper()
	h.flowStateMachine.mutex.Lock()
	defer h.flowStateMachine.mutex.Unlock()

	if h.flowStateMachine.value == nil {
		h.flowStateMachine.value = service.NewFlowEngine(service.FlowEngineDeps{
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
			Protection:     h.newSignupProtection(t),
			HTTPClient:     h.EnsureHttpClient(t),
			Now:            time.Now,
		})
	}
	return h.flowStateMachine.value
}
