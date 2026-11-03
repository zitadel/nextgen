package helpers

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	api "github.com/zitadel/nextgen/api/generated"
)

// A generated response type handed over by value must still marshal. ogen's
// MarshalJSON is on the pointer receiver, so without addressing it first
// encoding/json walks the fields and dies on the first unset optional one.
func TestMustMarshalAcceptsValues(t *testing.T) {
	user := api.User{ID: "usr_1", Schema: "sch_1"}

	got := MustMarshal(t, user)
	assert.JSONEq(t, MustMarshal(t, &user), got)
	require.Contains(t, got, `"id":"usr_1"`)
	// Unset optionals stay off the wire rather than breaking the encode.
	assert.NotContains(t, got, "teams_truncated")
}
