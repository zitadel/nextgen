package helpers

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"
)

func LogInvalidResponse(t *testing.T, resp any) {
	bs, err := json.Marshal(resp)
	require.NoError(t, err)
	t.Log(string(bs))
}
