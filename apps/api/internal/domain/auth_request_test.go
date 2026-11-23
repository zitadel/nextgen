package domain

import (
	"encoding/base64"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewAuthCode(t *testing.T) {
	code, hash, err := NewAuthCode()
	require.NoError(t, err)
	raw, err := base64.RawURLEncoding.DecodeString(code)
	require.NoError(t, err)
	assert.Len(t, raw, 32)
	assert.Equal(t, HashSecret(code), hash)

	other, _, err := NewAuthCode()
	require.NoError(t, err)
	assert.NotEqual(t, code, other)
}
