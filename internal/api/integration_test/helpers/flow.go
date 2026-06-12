package helpers

import (
	"testing"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/domain/idgen"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database/repository"
)

func (h *Harness) EnsureCreateUserHandler(t *testing.T) *domain.FlowCreateUserHandler {
	t.Helper()
	return domain.NewFlowCreateUserHandler(
		idgen.NewULID(),
		h.EnsureUserRepo(t),
		h.EnsureUserPasswordRepo(t),
		h.EnsureHasher(t),
	)
}

func (h *Harness) EnsureFlowService(t *testing.T) service.FlowService {
	t.Helper()
	h.mu.Lock()
	svc := h.FlowService
	h.mu.Unlock()
	if svc != nil {
		return svc
	}
	svc = service.NewFlowService(
		h.EnsureDBPool(t),
		h.EnsureFlowDefinitionRepo(t),
		h.EnsureFlowStateMachine(t),
		idgen.NewULID(),
	)
	h.mu.Lock()
	if h.FlowService == nil {
		h.FlowService = svc
	}
	svc = h.FlowService
	h.mu.Unlock()
	return svc
}

func (h *Harness) EnsureFlowStateMachine(t *testing.T) *domain.FlowStateMachineRuntime {
	t.Helper()
	h.mu.Lock()
	runtime := h.FlowStateMachine
	h.mu.Unlock()
	if runtime != nil {
		return runtime
	}
	fields := domain.NewSchemaFieldResolver(h.EnsureSchemaResolver(t))
	authAdapter := service.NewFlowAuthAttemptAdapter(h.EnsureAuthAttemptService(t))
	passkeyRegSvc := service.NewPasskeyRegistrationService(
		h.EnsureDBPool(t),
		repository.NewPasskeyRegistrationRepository(),
		h.EnsureUserPasskeyRepo(t),
		idgen.NewULID(),
	)
	passkeyRegAdapter := service.NewFlowPasskeyRegistrationAdapter(passkeyRegSvc)
	runtime = domain.NewFlowStateMachine(fields, h.EnsureCreateUserHandler(t), authAdapter, passkeyRegAdapter, time.Now)
	h.mu.Lock()
	if h.FlowStateMachine == nil {
		h.FlowStateMachine = runtime
	}
	runtime = h.FlowStateMachine
	h.mu.Unlock()
	return runtime
}

func (h *Harness) EnsureFlowDefinitionRepo(t *testing.T) domain.FlowDefinitionRepository {
	t.Helper()
	h.mu.Lock()
	repo := h.FlowDefinitionRepo
	h.mu.Unlock()
	if repo != nil {
		return repo
	}
	repo = repository.NewFlowDefinitionRepository(
		h.EnsureDBPool(t),
	)
	h.mu.Lock()
	if h.FlowDefinitionRepo == nil {
		h.FlowDefinitionRepo = repo
	}
	repo = h.FlowDefinitionRepo
	h.mu.Unlock()
	return repo
}
