package helpers

import (
	"testing"

	"github.com/zitadel/nextgen/internal/secrets"
)

func (h *Harness) EnsureSecretGenerator(t *testing.T) secrets.Generator {
	t.Helper()
	h.mu.Lock()
	generator := h.SecretGenerator
	h.mu.Unlock()
	if generator != nil {
		return generator
	}
	generator = secrets.NewRandomSecretGenerator()
	h.mu.Lock()
	if h.SecretGenerator == nil {
		h.SecretGenerator = generator
	}
	generator = h.SecretGenerator
	h.mu.Unlock()
	return generator
}
