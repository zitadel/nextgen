package helpers

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"
)

func MustMarshal(t *testing.T, v any) string {
	t.Helper()
	m, err := json.Marshal(v)
	require.NoError(t, err)
	return string(m)
}

func MustUnmarshal[T any](t *testing.T, bs []byte) *T {
	t.Helper()
	v := new(T)
	err := json.Unmarshal(bs, v)
	require.NoError(t, err)
	return v
}
