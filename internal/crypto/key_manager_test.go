package crypto

import (
"crypto/aes"
"encoding/binary"
"testing"

"github.com/stretchr/testify/assert"
"github.com/stretchr/testify/require"
)

func TestKeyManager_EncryptDecrypt(t *testing.T) {
t.Parallel()

activeKey := []byte("12345678901234567890123456789012")
km := NewKeyManager(activeKey)
plaintext := []byte("hello key manager")

ciphertext, err := km.Encrypt(plaintext)
require.NoError(t, err)
require.GreaterOrEqual(t, len(ciphertext), 4)

fingerprint := binary.BigEndian.Uint32(ciphertext[:4])
assert.Equal(t, km.activeFingerprint, fingerprint)

decrypted, err := km.Decrypt(ciphertext)
require.NoError(t, err)
assert.Equal(t, plaintext, decrypted)
}

func TestKeyManager_DecryptWithOldKey(t *testing.T) {
t.Parallel()

oldKey := []byte("abcdefghijklmnopqrstuvwx12345678")
newKey := []byte("1234567890abcdefghijklmnopqrstuv")

oldManager := NewKeyManager(oldKey)
ciphertext, err := oldManager.Encrypt([]byte("rotated secret"))
require.NoError(t, err)

newManager := NewKeyManager(newKey, oldKey)
decrypted, err := newManager.Decrypt(ciphertext)
require.NoError(t, err)
assert.Equal(t, []byte("rotated secret"), decrypted)
}

func TestKeyManager_DecryptErrors(t *testing.T) {
t.Parallel()

t.Run("ciphertext too short", func(t *testing.T) {
t.Parallel()

km := NewKeyManager([]byte("12345678901234567890123456789012"))
_, err := km.Decrypt([]byte("short"))
require.Error(t, err)
assert.EqualError(t, err, "invalid ciphertext")
})

t.Run("unknown key fingerprint", func(t *testing.T) {
t.Parallel()

km := NewKeyManager([]byte("12345678901234567890123456789012"))
payload := make([]byte, 16)
binary.BigEndian.PutUint32(payload[:4], 0xdeadbeef)

_, err := km.Decrypt(payload)
require.Error(t, err)
assert.EqualError(t, err, "unknown key fingerprint: deadbeef")
})
}

func TestKeyManager_EncryptErrorsWhenActiveKeyInvalid(t *testing.T) {
t.Parallel()

invalidKey := []byte("short")
km := NewKeyManager(invalidKey)

_, err := km.Encrypt([]byte("secret"))
require.Error(t, err)
assert.EqualError(t, err, aes.KeySizeError(len(invalidKey)).Error())
}
