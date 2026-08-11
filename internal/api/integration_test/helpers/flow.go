package helpers

import (
	"testing"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

func (h *Harness) EnsureCreateUserHandler(t *testing.T) *service.FlowCreateUserWithPasswordHandler {
	t.Helper()
	return service.NewFlowCreateUserHandler(
		h.EnsureHasher(t),
		h.EnsureUserService(t),
		h.EnsureSchemaStore(t),
		h.EnsureServiceDB(t),
	)
}

func (h *Harness) EnsureFlowCreateUserForPasskeyHandler(t *testing.T) *service.FlowCreateUserForPasskeyHandler {
	t.Helper()
	return service.NewFlowCreateUserForPasskeyHandler(
		h.EnsureUserService(t),
		h.EnsureSchemaStore(t),
	)
}

func (h *Harness) EnsureFlowService(t *testing.T) service.FlowService {
	t.Helper()
	h.flowService.mutex.Lock()
	defer h.flowService.mutex.Unlock()

	if h.flowService.value == nil {
		h.flowService.value = service.NewFlowService(
			h.EnsureServiceDB(t),
			h.EnsureFlowStateMachine(t),
		)
	}
	return h.flowService.value
}

func (h *Harness) EnsureFlowStateMachine(t *testing.T) *domain.FlowStateMachineRuntime {
	t.Helper()
	h.flowStateMachine.mutex.Lock()
	defer h.flowStateMachine.mutex.Unlock()

	if h.flowStateMachine.value == nil {
		fields := domain.NewSchemaFieldResolver()
		authAdapter := service.NewFlowAuthAttemptAdapter(h.EnsureAuthAttemptService(t))
		passkeyRegSvc := service.NewPasskeyRegistrationService(
			h.EnsureServiceDB(t),
		)
		passkeyRegAdapter := service.NewFlowPasskeyRegistrationAdapter(passkeyRegSvc)
		h.flowStateMachine.value = domain.NewFlowStateMachine(
			h.EnsureSchemaResolver(t),
			h.EnsureSchemaStore(t),
			fields,
			h.EnsureCreateUserHandler(t),
			h.EnsureFlowCreateUserForPasskeyHandler(t),
			authAdapter,
			passkeyRegAdapter,
			time.Now,
		)
	}
	return h.flowStateMachine.value
}
