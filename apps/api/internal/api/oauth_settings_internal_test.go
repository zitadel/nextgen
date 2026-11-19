package api

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"

	api "github.com/zitadel/nextgen/internal/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
)

// No release stores OAuth settings yet, so every ID is one nobody holds: the
// read answers the documented 404, not the 500 an unhandled operation gives.
func TestGetOAuthSettingsAnswersNotFound(t *testing.T) {
	h := &Handler{}

	res, err := h.GetOAuthSettings(t.Context(), api.GetOAuthSettingsParams{OAuthSettingsID: "oauthset_01KW0000000000000000000000"})

	require.Nil(t, res)
	require.ErrorIs(t, err, domain.ErrOAuthSettingsNotFound())
	require.Equal(t, http.StatusNotFound, errorResponse(err).StatusCode)
}
