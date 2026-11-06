package powtest

import (
	"crypto/pbkdf2"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/crypto/pow"
	"testing"
)

// Solve exercises the public protocol without access to stored verifier state.
func Solve(t *testing.T, c *pow.PublicChallenge) string {
	t.Helper()
	salt, err := hex.DecodeString(c.Salt)
	require.NoError(t, err)
	nonce, err := hex.DecodeString(c.Nonce)
	require.NoError(t, err)
	input := make([]byte, 20)
	copy(input, nonce)
	for counter := uint32(0); counter < 512; counter++ {
		binary.BigEndian.PutUint32(input[16:], counter)
		key, err := pbkdf2.Key(sha256.New, string(input), salt, 5000, 32)
		require.NoError(t, err)
		if hex.EncodeToString(key[:16]) == c.KeyPrefix {
			raw, err := json.Marshal(map[string]string{"protocol": c.Protocol, "challenge_id": c.ChallengeID, "derived_key": hex.EncodeToString(key)})
			require.NoError(t, err)
			return string(raw)
		}
	}
	t.Fatal("no solution in profile")
	return ""
}
