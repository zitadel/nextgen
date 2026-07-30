package helpers

import (
	"testing"

	"github.com/zitadel/nextgen/internal/service"
)

func (h *Harness) EnsurePasskeyRegistrationService(t *testing.T) *service.PasskeyRegistrationService {
	t.Helper()
	return service.NewPasskeyRegistrationService(
		h.EnsureServiceDB(t),
	)
}
