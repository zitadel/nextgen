package api

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	api "github.com/zitadel/nextgen/internal/api/generated"
)

// Pins the members list's answer until it lands: 501, not the 500 the
// generated stub's sentinel would map to.
func TestListProjectMembersNotImplemented(t *testing.T) {
	_, err := (&Handler{}).ListProjectMembers(t.Context(), api.ListProjectMembersParams{})
	require.Error(t, err)
	assert.Equal(t, http.StatusNotImplemented, errorResponse(err).StatusCode)
}
