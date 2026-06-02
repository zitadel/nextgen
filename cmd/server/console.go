package server

import (
	"io/fs"
	"net/http"
	"path"
	"strings"
)

const consoleMountPath = "/console/"

func withConsoleHandler(apiHandler http.Handler, consoleFS fs.FS) http.Handler {
	consoleHandler := newConsoleHandler(consoleFS)

	mux := http.NewServeMux()
	mux.Handle("/console", http.RedirectHandler(consoleMountPath, http.StatusPermanentRedirect))
	mux.Handle(consoleMountPath, consoleHandler)
	mux.Handle("/", apiHandler)
	return mux
}

func newConsoleHandler(consoleFS fs.FS) http.Handler {
	fileServer := http.FileServer(http.FS(consoleFS))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.NotFound(w, r)
			return
		}

		rel := strings.TrimPrefix(r.URL.Path, consoleMountPath)
		rel = path.Clean("/" + rel)[1:]
		if rel != "." && consoleFileExists(consoleFS, rel) {
			assetRequest := r.Clone(r.Context())
			assetRequest.URL.Path = "/" + rel
			fileServer.ServeHTTP(w, assetRequest)
			return
		}

		http.ServeFileFS(w, r, consoleFS, "index.html")
	})
}

func consoleFileExists(consoleFS fs.FS, name string) bool {
	info, err := fs.Stat(consoleFS, name)
	return err == nil && !info.IsDir()
}
