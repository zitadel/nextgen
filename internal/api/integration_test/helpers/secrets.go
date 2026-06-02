package helpers

import (
	"testing"

	"github.com/zitadel/nextgen/internal/secrets"
)

func (h *Harness) EnsureSecretGenerator(t *testing.T) secrets.Generator {
	t.Helper()
	if h.SecretGenerator == nil {
		h.SecretGenerator = secrets.NewRandomSecretGenerator()
	}
	return h.SecretGenerator
}
