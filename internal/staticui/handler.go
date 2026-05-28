// Package staticui serves an embedded SPA under a URL prefix with
// trailing-slash redirect and index.html fallback for client-side routes.
package staticui

import (
	"io/fs"
	"net/http"
	"path"
	"strings"
)

// New returns an http.Handler that serves static files from root under prefix.
// prefix is normalized to "/segment" (no trailing slash); requests to prefix
// without a trailing slash receive a permanent redirect to prefix+"/".
func New(prefix string, root fs.FS) http.Handler {
	prefix = strings.TrimSuffix(strings.TrimSpace(prefix), "/")
	if prefix == "" {
		prefix = "/"
	}
	mount := prefix + "/"

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == prefix {
			http.Redirect(w, r, mount, http.StatusPermanentRedirect)
			return
		}
		if !strings.HasPrefix(r.URL.Path, mount) {
			http.NotFound(w, r)
			return
		}
		http.StripPrefix(mount, fileHandler(root)).ServeHTTP(w, r)
	})
}

func fileHandler(root fs.FS) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.NotFound(w, r)
			return
		}

		name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if name == "" || name == "." {
			name = "index.html"
		}

		if _, err := fs.Stat(root, name); err == nil {
			http.ServeFileFS(w, r, root, name)
			return
		}

		if !strings.Contains(path.Base(name), ".") {
			http.ServeFileFS(w, r, root, "index.html")
			return
		}

		http.NotFound(w, r)
	})
}
