//go:build integration

package helpers

import (
	"testing"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database/repository"
)

func (h *Harness) EnsureFlowService(t *testing.T) service.FlowService {
	t.Helper()
	if h.FlowService == nil {
		h.FlowService = service.NewFlowService(
			h.EnsureDBPool(t),
			h.EnsureFlowDefinitionRepo(t),
		)
	}
	return h.FlowService
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
