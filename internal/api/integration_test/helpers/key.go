package helpers

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/cache"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/oidc/v3/pkg/op"
)

// keyCacheSize is generous: the harness holds one key service for the whole
// run, and a project's keys should not be evicted by another project's.
const keyCacheSize = 512

func (h *Harness) EnsureKeyService(t *testing.T) service.KeyService {
	t.Helper()
	h.keyService.mutex.Lock()
	defer h.keyService.mutex.Unlock()

	if h.keyService.value == nil {
		crypters, err := cache.NewMeteredLRU[service.CrypterCacheKey, op.Crypto](cache.NameCrypter, keyCacheSize)
		require.NoError(t, err)
		signingKeys, err := cache.NewMeteredLRU[service.SigningKeyCacheKey, domain.SigningKey](cache.NameSigningKey, keyCacheSize)
		require.NoError(t, err)

		h.keyService.value = service.NewKeyService(
			h.EnsureServiceDB(t),
			*(h.EnsureMasterKey(t)),
			crypters,
			signingKeys,
		)
	}
	return h.keyService.value
}
