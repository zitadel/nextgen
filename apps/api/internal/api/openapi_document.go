package api

import (
	"bytes"
	"net/http"
	"time"

	openapibundled "github.com/zitadel/nextgen/api/openapi/bundled"
)

// openAPIDocumentHandler serves the OpenAPI document this binary embeds.
// Mounted by MountAPI outside the ogen chain so discovery needs no auth.
// CORS * is for cross-origin GET from API tools; there is no OPTIONS route —
// simple GETs do not preflight.
func openAPIDocumentHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "public, max-age=300")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		http.ServeContent(w, r, "openapi.json", time.Time{}, bytes.NewReader(openapibundled.Document()))
	})
}
