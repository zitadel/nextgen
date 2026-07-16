package helpers

import (
	"testing"

	"github.com/zitadel/nextgen/internal/service"
)

func (h *Harness) EnsureKeyService(t *testing.T) service.KeyService {
	t.Helper()
	if h.KeyService == nil {
		h.KeyService = service.NewKeyService(
			h.EnsureServiceDB(t),
			h.EnsureCrypter(t),
		)
	}
	return h.KeyService
}
