package helpers

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/service"
)

// keyCacheSize is generous: the harness holds one key service for the whole
// run, and a project's keys should not be evicted by another project's.
const keyCacheSize = 512

func (h *Harness) EnsureKeyService(t *testing.T) service.KeyService {
	t.Helper()
	h.keyService.mutex.Lock()
	defer h.keyService.mutex.Unlock()

	if h.keyService.value == nil {
		encryptionKeys, err := service.NewLRUEncryptionKeyCache(keyCacheSize)
		require.NoError(t, err)
		signingKeys, err := service.NewLRUSigningKeyCache(keyCacheSize)
		require.NoError(t, err)

		h.keyService.value = service.NewKeyService(
			h.EnsureServiceDB(t),
			*(h.EnsureMasterKey(t)),
			encryptionKeys,
			signingKeys,
		)
	}
	return h.keyService.value
}
