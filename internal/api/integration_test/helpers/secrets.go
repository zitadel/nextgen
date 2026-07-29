package helpers

import (
	"testing"

	"github.com/zitadel/nextgen/internal/secrets"
)

func (h *Harness) EnsureSecretGenerator(t *testing.T) secrets.Generator {
	t.Helper()
	h.secretGenerator.mutex.Lock()
	defer h.secretGenerator.mutex.Unlock()

	if h.secretGenerator.value == nil {
		h.secretGenerator.value = secrets.NewRandomSecretGenerator()
	}
	return h.secretGenerator.value
}
