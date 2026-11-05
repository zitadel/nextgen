package migratev4

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSecretDigest(t *testing.T) {
	first, err := secretDigest("corp-secret-123")
	require.NoError(t, err)
	second, err := secretDigest("corp-secret-123")
	require.NoError(t, err)

	assert.True(t, strings.HasPrefix(first, "argon2id$"))
	assert.NotContains(t, first, ".", "a mapping fingerprint joins source and digest with a dot")
	assert.NotEqual(t, first, second, "each digest has its own salt")
	assert.True(t, secretMatches(first, "corp-secret-123"))
	assert.True(t, secretMatches(second, "corp-secret-123"))
	assert.False(t, secretMatches(first, "corp-secret-124"))

	fast := sha256.Sum256([]byte(`"corp-secret-123"`))
	for _, other := range []string{"", "argon2id", "argon2id$!!$x", hex.EncodeToString(fast[:])} {
		assert.False(t, secretMatches(other, "corp-secret-123"), "%q", other)
	}
}

func TestSecretUnchanged(t *testing.T) {
	digest, err := secretDigest("s3cret")
	require.NoError(t, err)
	recorded := "source-fp." + digest

	assert.True(t, secretUnchanged(recorded, "source-fp", "s3cret"))
	assert.False(t, secretUnchanged(recorded, "other-fp", "s3cret"), "the source ciphertext changed")
	assert.False(t, secretUnchanged(recorded, "source-fp", "changed"), "the secret changed")
	assert.False(t, secretUnchanged(digest, "source-fp", "s3cret"), "no source part")
}
