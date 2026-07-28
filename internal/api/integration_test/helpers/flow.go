package helpers

import (
	"testing"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/domain/idgen"
	"github.com/zitadel/nextgen/internal/service"
)

func (h *Harness) EnsureCreateUserHandler(t *testing.T) *service.FlowCreateUserWithPasswordHandler {
	t.Helper()
	return service.NewFlowCreateUserHandler(
		h.EnsureHasher(t),
		h.EnsureUserService(t),
		h.EnsureSchemaStore(t),
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
	if h.FlowService == nil {
		h.FlowService = service.NewFlowService(
			h.EnsureDBPool(t),
			h.EnsureServiceDB(t),
			h.EnsureFlowStateMachine(t),
			idgen.NewULID(),
		)
	}
	return h.FlowService
}

func (h *Harness) EnsureFlowStateMachine(t *testing.T) *domain.FlowStateMachineRuntime {
	t.Helper()
	if h.FlowStateMachine == nil {
		fields := domain.NewSchemaFieldResolver()
		authAdapter := service.NewFlowAuthAttemptAdapter(h.EnsureAuthAttemptService(t))
		passkeyRegSvc := service.NewPasskeyRegistrationService(
			h.EnsureDBPool(t),
			h.EnsureServiceDB(t),
			h.EnsureUserPasskeyRepo(t),
			idgen.NewULID(),
		)
		passkeyRegAdapter := service.NewFlowPasskeyRegistrationAdapter(passkeyRegSvc)
		h.FlowStateMachine = domain.NewFlowStateMachine(
			h.EnsureSchemaResolver(t),
			h.EnsureSchemaStore(t),
			fields,
			h.EnsureCreateUserHandler(t),
			h.EnsureFlowCreateUserForPasskeyHandler(t),
			authAdapter,
			passkeyRegAdapter,
			idgen.NewULID(),
			time.Now,
		)
	}
	return h.FlowStateMachine
}
