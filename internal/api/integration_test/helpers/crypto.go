package helpers

import (
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/crypto"
)

func (h *Harness) EnsureHasher(t *testing.T) *crypto.Hasher {
	t.Helper()
	if h.Hasher == nil {
		cfg := crypto.HashConfig{
			Verifiers: []crypto.HashName{crypto.HashNameBcrypt},
			Hasher: crypto.HasherConfig{
				Algorithm: crypto.HashNameBcrypt,
				Params: map[string]any{
					"cost": 10,
				},
			},
			Limits: crypto.HashLimitsConfig{
				Bcrypt: crypto.BcryptLimitsConfig{
					MinCost: 10,
					MaxCost: 16,
				},
			},
		}
		hasher, err := cfg.NewHasher()
		require.NoError(t, err)
		h.Hasher = hasher
	}
	return h.Hasher
}
