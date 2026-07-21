package helpers

import (
	"testing"

	"github.com/zitadel/nextgen/internal/domain/idgen"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database/repository"
)

func (h *Harness) EnsurePasskeyRegistrationService(t *testing.T) *service.PasskeyRegistrationService {
	t.Helper()
	return service.NewPasskeyRegistrationService(
		h.EnsureDBPool(t),
		h.ServiceDB(t),
		repository.NewPasskeyRegistrationRepository(),
		idgen.NewULID(),
	)
}
