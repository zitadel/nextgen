package helpers

import (
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/cookie"
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

func (h *Harness) EnsureSealer(t *testing.T) *cookie.Sealer {
	t.Helper()
	if h.Sealer == nil {
		sealer, err := cookie.NewSealer(cookie.Key([]byte("MasterkeyNeedsToHave32Characters")))
		require.NoError(t, err)
		h.Sealer = sealer
	}
	return h.Sealer
}
