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
	h := staticui.New("/ui/login", root)

	req := httptest.NewRequest(http.MethodGet, "/ui/login/", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Contains(t, rec.Body.String(), "index-body")
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
}
