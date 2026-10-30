package helpers

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/api/middleware"
	"github.com/zitadel/nextgen/internal/domain"
)

// The guard names an error answer the server gave without recording its
// cause by the request line sharing its request id, and passes the answers
// whose cause was recorded.
func TestHarness_UnrecordedErrors(t *testing.T) {
	t.Parallel()
	h := new(Harness)
	mux := http.NewServeMux()
	mux.HandleFunc("/recorded", func(w http.ResponseWriter, r *http.Request) {
		middleware.RecordError(r.Context(), domain.ErrRequestNotFound())
		w.WriteHeader(http.StatusNotFound)
	})
	mux.HandleFunc("/unrecorded", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	})
	mux.HandleFunc("/ok", func(http.ResponseWriter, *http.Request) {})
	srv := h.withServerLog(mux)
	for _, path := range []string{"/recorded", "/ok"} {
		srv.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, path, nil))
	}
	require.NoError(t, h.UnrecordedErrors())

	srv.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/unrecorded?secret=1", nil))
	err := h.UnrecordedErrors()
	require.Error(t, err)
	assert.Contains(t, err.Error(), "1 answers without a recorded error")
	assert.Contains(t, err.Error(), "POST /unrecorded (request_id req_")
	assert.NotContains(t, err.Error(), "/recorded")
	assert.NotContains(t, err.Error(), "secret")
}
