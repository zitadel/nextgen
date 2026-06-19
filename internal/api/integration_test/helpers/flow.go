package helpers

import (
	"testing"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/domain/idgen"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database/repository"
)

func (h *Harness) EnsureCreateUserHandler(t *testing.T) *service.FlowCreateUserHandler {
	t.Helper()
	return service.NewFlowCreateUserHandler(
		h.EnsureUserRepo(t),
		h.EnsureUserPasswordRepo(t),
		h.EnsureHasher(t),
		h.EnsureUserService(t),
		h.EnsureSchemaRepo(t),
	)
}

func (h *Harness) EnsureFlowService(t *testing.T) service.FlowService {
	t.Helper()
	if h.FlowService == nil {
		h.FlowService = service.NewFlowService(
			h.EnsureDBPool(t),
			h.EnsureFlowDefinitionRepo(t),
			h.EnsureFlowStateMachine(t),
			idgen.NewULID(),
		)
	}
	return h.FlowService
}

func (h *Harness) EnsureFlowStateMachine(t *testing.T) *service.FlowStateMachineRuntime {
	t.Helper()
	if h.FlowStateMachine == nil {
		fields := domain.NewSchemaFieldResolver(h.EnsureSchemaResolver(t))
		authAdapter := service.NewFlowAuthAttemptAdapter(h.EnsureAuthAttemptService(t))
		passkeyRegSvc := service.NewPasskeyRegistrationService(
			h.EnsureDBPool(t),
			repository.NewPasskeyRegistrationRepository(),
			h.EnsureUserPasskeyRepo(t),
			idgen.NewULID(),
		)
		passkeyRegAdapter := service.NewFlowPasskeyRegistrationAdapter(passkeyRegSvc)
		h.FlowStateMachine = service.NewFlowStateMachine(
			fields,
			h.EnsureCreateUserHandler(t),
			authAdapter,
			passkeyRegAdapter,
			h.EnsureUserService(t),
			time.Now,
		)
	}
	return h.FlowStateMachine
}

func (h *Harness) EnsureFlowDefinitionRepo(t *testing.T) domain.FlowDefinitionRepository {
	t.Helper()
	if h.FlowDefinitionRepo == nil {
		h.FlowDefinitionRepo = repository.NewFlowDefinitionRepository(
			h.EnsureDBPool(t),
		)
	}
	return h.FlowDefinitionRepo
}
