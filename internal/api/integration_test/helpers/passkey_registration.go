package helpers

import (
	"testing"

	"github.com/zitadel/nextgen/internal/domain/idgen"
	"github.com/zitadel/nextgen/internal/service"
)

func (h *Harness) EnsurePasskeyRegistrationService(t *testing.T) *service.PasskeyRegistrationService {
	t.Helper()
	return service.NewPasskeyRegistrationService(
		h.EnsureDBPool(t),
		h.EnsureServiceDB(t),
		h.EnsureUserPasskeyRepo(t),
		idgen.NewULID(),
	)
}
