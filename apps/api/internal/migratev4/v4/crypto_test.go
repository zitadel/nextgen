package v4

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// A vector from a real v4.19.5 database (the demo fixture): the stored
// idpConfigKey, and the client secret of a generic OIDC IdP as its
// instance.idp.oidc.added payload carries it. The secret is corp-secret-123.
const (
	vectorMasterKey  = "MasterkeyNeedsToHave32Characters"
	vectorWrappedKey = "HZZTBXfDqKnwudPip4TIenm6cIm1epi6o6EvyH7RplBWLlrBlO0i861LVoD7vznz"
	vectorSecret     = `{"KeyID": "idpConfigKey", "Crypted": "+AEuz/dfK+ZQeXvfRJxXgT68EQKfE/r+nzbQSP5ajw==", "Algorithm": "aes", "CryptoType": 0}`
)

func TestDecryptString_RealV4Vector(t *testing.T) {
	key, err := unwrapKey(vectorWrappedKey, []byte(vectorMasterKey))
	require.NoError(t, err)
	require.Len(t, key, 32)

	var secret CryptoValue
	require.NoError(t, json.Unmarshal([]byte(vectorSecret), &secret))
	keys := &Keys{keys: map[string][]byte{"idpConfigKey": key}}

	plain, err := keys.DecryptString(&secret)
	require.NoError(t, err)
	assert.Equal(t, "corp-secret-123", plain)
}

func TestDecryptString_WrongMasterKeyIsRefused(t *testing.T) {
	key, err := unwrapKey(vectorWrappedKey, []byte("WrongMasterkeyWith32Characters!!"))
	require.NoError(t, err, "CFB has no MAC: a wrong master key unwraps to garbage, not to an error")

	var secret CryptoValue
	require.NoError(t, json.Unmarshal([]byte(vectorSecret), &secret))
	keys := &Keys{keys: map[string][]byte{"idpConfigKey": key}}

	_, err = keys.DecryptString(&secret)
	assert.ErrorContains(t, err, "master key")
}

func TestDecryptString_UnknownKeyAndAlgorithm(t *testing.T) {
	keys := &Keys{keys: map[string][]byte{}}
	_, err := keys.DecryptString(&CryptoValue{Algorithm: "aes", KeyID: "otpKey", Crypted: make([]byte, 20)})
	assert.ErrorContains(t, err, `"otpKey" not found`)
	_, err = keys.DecryptString(&CryptoValue{Algorithm: "bcrypt", Crypted: []byte("$2a$")})
	assert.ErrorContains(t, err, "unsupported algorithm")
}
