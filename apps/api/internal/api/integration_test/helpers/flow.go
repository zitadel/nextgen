//go:build postgres_integration || spanner_integration || sqlite_integration

package helpers

import (
	"testing"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

func (h *Harness) EnsureCreateUserHandler(t testing.TB) *service.FlowCreateUserWithPasswordHandler {
	t.Helper()
	return service.NewFlowCreateUserHandler(
		h.EnsureProjectHashers(t),
		h.EnsurePasswordPolicy(t),
		h.EnsureUserService(t),
		h.EnsureSchemaStore(t),
		h.EnsureServiceDB(t),
		h.newSignupProtection(t))
}

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

func (h *Harness) EnsureFlowStateMachine(t testing.TB) *domain.FlowStateMachineRuntime {
	t.Helper()
	h.flowStateMachine.mutex.Lock()
	defer h.flowStateMachine.mutex.Unlock()

	if h.flowStateMachine.value == nil {
		fields := domain.NewSchemaFieldResolver()
		authAdapter := service.NewFlowAuthAttemptAdapter(h.EnsureAuthAttemptService(t), h.EnsureSchemaStore(t), h.newSignupProtection(t))
		h.flowStateMachine.value = domain.NewFlowStateMachine(
			h.EnsureSchemaResolver(t),
			h.EnsureSchemaStore(t),
			fields,
			h.EnsureCreateUserHandler(t),
			authAdapter,
			service.NewFlowSSOProviderResolver(h.EnsureIDPConnectionService(t)),
			service.NewFlowSSOIdentityResolver(h.EnsureServiceDB(t), h.EnsureIDPConnectionService(t), h.EnsureUserService(t), h.EnsureSchemaStore(t), h.EnsureProjectHashers(t), h.EnsurePasswordPolicy(t)),
			service.NewFlowSSORedirectIssuer(h.EnsureIDPConnectionService(t), h.EnsureAuthAttemptService(t), h.EnsureKeyService(t), h.EnsureVariableService(t), h.EnsureHttpClient(t)),
			h.EnsurePasswordPolicy(t),
			time.Now,
		)
	}
	return h.flowStateMachine.value
}
