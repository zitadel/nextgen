package domain

import (
	"encoding/base64"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewAuthCode(t *testing.T) {
	code, hash, err := NewAuthCode("dep_1")
	require.NoError(t, err)
	random, ok := strings.CutPrefix(code, "dep_1.")
	require.True(t, ok, "code %q names its deployment first", code)
	raw, err := base64.RawURLEncoding.DecodeString(random)
	require.NoError(t, err)
	assert.Len(t, raw, 32)
	assert.Equal(t, HashSecret(code), hash, "the hash covers the whole code")
	assert.Equal(t, "dep_1", AuthCodeDeploymentID(code))

	other, _, err := NewAuthCode("dep_1")
	require.NoError(t, err)
	assert.NotEqual(t, code, other)
}

// A request without a deployment gets the random part alone.
func TestNewAuthCodeWithoutDeployment(t *testing.T) {
	code, hash, err := NewAuthCode("")
	require.NoError(t, err)
	assert.NotContains(t, code, ".")
	raw, err := base64.RawURLEncoding.DecodeString(code)
	require.NoError(t, err)
	assert.Len(t, raw, 32)
	assert.Equal(t, HashSecret(code), hash)
	assert.Empty(t, AuthCodeDeploymentID(code))
}

func TestAuthCodeDeploymentID(t *testing.T) {
	tests := []struct {
		name string
		code string
		want string
	}{
		{name: "prefix", code: "dep_1.random", want: "dep_1"},
		{name: "no_prefix", code: "random"},
		{name: "empty"},
		{name: "empty_prefix", code: ".random"},
		{name: "several_dots", code: "dep_1.ran.dom", want: "dep_1"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, AuthCodeDeploymentID(tt.code))
		})
	}
}
