package helpers

import (
	"encoding/json"
	"log"
	"testing"

	"github.com/stretchr/testify/require"
)

func LogInvalidResponse(t *testing.T, resp any) {
	bs, err := json.Marshal(resp)
	require.NoError(t, err)
	log.Println(string(bs))
}
