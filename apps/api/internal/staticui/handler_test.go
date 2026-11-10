package staticui_test

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/staticui"
)

func TestNew_trailingSlashRedirect(t *testing.T) {
	root := fstest.MapFS{
		"index.html": &fstest.MapFile{Data: []byte("ok")},
	}
	h := staticui.New("/ui/console", root)

	req := httptest.NewRequest(http.MethodGet, "/ui/console", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusPermanentRedirect, rec.Code)
	assert.Equal(t, "/ui/console/", rec.Header().Get("Location"))
}

func TestNew_servesIndex(t *testing.T) {
	root := fstest.MapFS{
		"index.html": &fstest.MapFile{Data: []byte("index-body")},
	}
	h := staticui.New("/ui/console", root)

	req := httptest.NewRequest(http.MethodGet, "/ui/console/", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Contains(t, rec.Body.String(), "index-body")
	assert.Equal(t, "no-store", rec.Header().Get("Cache-Control"))
}

func TestNew_spaFallback(t *testing.T) {
	root := fstest.MapFS{
		"index.html": &fstest.MapFile{Data: []byte("spa-shell")},
	}
	h := staticui.New("/ui/console", root)

	req := httptest.NewRequest(http.MethodGet, "/ui/console/settings/team", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Contains(t, rec.Body.String(), "spa-shell")
	assert.Equal(t, "no-store", rec.Header().Get("Cache-Control"))
}

func TestNew_servesAsset(t *testing.T) {
	root := fstest.MapFS{
		"index.html":    &fstest.MapFile{Data: []byte("x")},
		"assets/app.js": &fstest.MapFile{Data: []byte("js-content")},
	}
	h := staticui.New("/ui/console", root)

	req := httptest.NewRequest(http.MethodGet, "/ui/console/assets/app.js", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	assert.Contains(t, rec.Body.String(), "js-content")
	assert.Equal(t, "public, max-age=31536000, immutable", rec.Header().Get("Cache-Control"))
}

func TestNew_fallbackAndMissingAssets(t *testing.T) {
	root := fstest.MapFS{
		"index.html":    &fstest.MapFile{Data: []byte("spa-shell")},
		"assets/app.js": &fstest.MapFile{Data: []byte("js-content")},
	}
	h := staticui.New("/ui/console", root)

	tests := []struct {
		name     string
		path     string
		wantCode int
		wantBody string
	}{
		{name: "route ending in a dotted id", path: "/ui/console/schemas/https%3A%2F%2Fh%2Fx.json", wantCode: http.StatusOK, wantBody: "spa-shell"},
		{name: "dotted route beside the assets folder", path: "/ui/console/assetsX/y.js", wantCode: http.StatusOK, wantBody: "spa-shell"},
		{name: "route ending in index.html", path: "/ui/console/schemas/https%3A%2F%2Fh%2Findex.html", wantCode: http.StatusOK, wantBody: "spa-shell"},
		{name: "route holding a dot-dot segment", path: "/ui/console/schemas/a%2F..%2Fb.json", wantCode: http.StatusOK, wantBody: "spa-shell"},
		{name: "missing asset", path: "/ui/console/assets/x.js", wantCode: http.StatusNotFound},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, tt.path, nil)
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)

			require.Equal(t, tt.wantCode, rec.Code)
			if tt.wantBody != "" {
				assert.Contains(t, rec.Body.String(), tt.wantBody)
			}
		})
	}
}
