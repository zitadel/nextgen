package api

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
)

func TestSchemaErrorResponse_FetchFailedIsBadRequest(t *testing.T) {
	t.Parallel()

	res := schemaErrorResponse(domain.ErrJSONSchemaFetchFailed())
	require.Equal(t, http.StatusBadRequest, res.StatusCode)
}
