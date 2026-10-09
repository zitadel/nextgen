package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestWithSessionStateNoStore(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		method     string
		path       string
		status     int
		wantHeader string
	}{
		{name: "successful session state", method: http.MethodGet, path: "/sessions/me", status: http.StatusOK, wantHeader: sessionStateCacheControl},
		{name: "unauthorized session state", method: http.MethodGet, path: "/sessions/me", status: http.StatusUnauthorized, wantHeader: sessionStateCacheControl},
		{name: "missing session state", method: http.MethodGet, path: "/sessions/me", status: http.StatusNotFound, wantHeader: sessionStateCacheControl},
		{name: "failed session state", method: http.MethodGet, path: "/sessions/me", status: http.StatusInternalServerError, wantHeader: sessionStateCacheControl},
		{name: "session revoke", method: http.MethodDelete, path: "/sessions/me", status: http.StatusNoContent},
		{name: "head is not the state operation", method: http.MethodHead, path: "/sessions/me", status: http.StatusOK},
		{name: "session child path", method: http.MethodGet, path: "/sessions/me/details", status: http.StatusOK},
		{name: "other operation", method: http.MethodGet, path: "/users/me", status: http.StatusOK},
		// Flow steps can carry the single-use handoff token.
		{name: "flow step render", method: http.MethodGet, path: "/flow/flow_1", status: http.StatusOK, wantHeader: sessionStateCacheControl},
		{name: "flow step render error", method: http.MethodGet, path: "/flow/flow_1", status: http.StatusGone, wantHeader: sessionStateCacheControl},
		{name: "flow step submit", method: http.MethodPost, path: "/flow/flow_1/submit", status: http.StatusOK, wantHeader: sessionStateCacheControl},
		{name: "flow step submit rejected", method: http.MethodPost, path: "/flow/flow_1/submit", status: http.StatusBadRequest, wantHeader: sessionStateCacheControl},
		{name: "flow start", method: http.MethodPost, path: "/flow", status: http.StatusCreated, wantHeader: sessionStateCacheControl},
		{name: "flow child path", method: http.MethodGet, path: "/flow/flow_1/other", status: http.StatusOK},
		{name: "flow submit read", method: http.MethodGet, path: "/flow/flow_1/submit", status: http.StatusOK},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			handler := WithSessionStateNoStore(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(tt.status)
			}))
			recorder := httptest.NewRecorder()
			handler.ServeHTTP(recorder, httptest.NewRequest(tt.method, tt.path, nil))

			assert.Equal(t, tt.status, recorder.Code)
			assert.Equal(t, tt.wantHeader, recorder.Header().Get("Cache-Control"))
		})
	}
}
