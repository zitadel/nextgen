package helpers

import (
	"testing"

	"github.com/go-jose/go-jose/v4"
	"github.com/stretchr/testify/require"
)

func (h *Harness) EnsureJoseSigner(t *testing.T) jose.Signer {
	t.Helper()
	h.joseSigner.mutex.Lock()
	defer h.joseSigner.mutex.Unlock()

	if h.joseSigner.value == nil {
		signer, err := jose.NewSigner(
			jose.SigningKey{
				Algorithm: jose.RS256,
				Key:       h.EnsureSigningKey(t),
			},
			nil,
		)
		require.NoError(t, err)
		h.joseSigner.value = signer
	}
	return h.joseSigner.value
}
