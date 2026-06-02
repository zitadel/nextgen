package server

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"

	"github.com/stretchr/testify/assert"
)

func TestWithConsoleHandlerServesConsoleAssetsAndPreservesAPI(t *testing.T) {
	consoleFS := fstest.MapFS{
		"index.html": {
			Data: []byte(`<!doctype html><div id="app"></div>`),
		},
		"assets/app.js": {
			Data: []byte(`console.log("console")`),
		},
	}
	apiHandler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("api"))
	})
	handler := withConsoleHandler(apiHandler, consoleFS)

	tests := []struct {
		name     string
		path     string
		status   int
		contains string
	}{
		{
			name:     "serves console root",
			path:     "/console/",
			status:   http.StatusOK,
			contains: `id="app"`,
		},
		{
			name:     "serves console asset",
			path:     "/console/assets/app.js",
			status:   http.StatusOK,
			contains: `console.log("console")`,
		},
		{
			name:     "falls back to spa index",
			path:     "/console/settings/users",
			status:   http.StatusOK,
			contains: `id="app"`,
		},
		{
			name:     "preserves api handler",
			path:     "/healthz",
			status:   http.StatusOK,
			contains: "api",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, tt.path, nil)
			rec := httptest.NewRecorder()

			handler.ServeHTTP(rec, req)

			assert.Equal(t, tt.status, rec.Code)
			assert.Contains(t, rec.Body.String(), tt.contains)
		})
	}
}
