package api

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
)

// The shared dispatch in errorResponse is what was missing: the connection
// prefix had no case, so its errors fell to the default branch and a missing
// id answered 500 where the spec documents 404 idp.not_found.
func TestErrorResponseMapsIDPConnectionErrors(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		err  domain.Error
		want int
	}{
		{"not found", domain.ErrIDPConnectionNotFound(), http.StatusNotFound},
		{
			"immutable field",
			domain.ErrIDPConnectionFieldImmutable(map[string]string{"field": "issuer"}),
			http.StatusBadRequest,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			got := errorResponse(tt.err)

			require.NotNil(t, got)
			assert.Equal(t, tt.want, got.StatusCode, "status for %s", tt.err.Code)
			assert.Equal(t, tt.err.Code, string(got.Response.Code), "the code must survive the mapping")
		})
	}
}

// A connection error this mapper does not know must not silently become a 404.
func TestIDPConnectionErrorResponseUnknownCodeIsInternal(t *testing.T) {
	t.Parallel()

	unknown := domain.Error{Code: domain.PrefixIDPConnection.ErrorCodePrefix("something_new")}

	got := idpConnectionErrorResponse(unknown)

	require.NotNil(t, got)
	assert.Equal(t, http.StatusInternalServerError, got.StatusCode)
}
