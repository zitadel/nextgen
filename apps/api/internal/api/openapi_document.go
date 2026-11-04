package api

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"time"

	openapibundled "github.com/zitadel/nextgen/api/openapi/bundled"
)

// Compacted embed + strong ETag, computed once so ServeContent can answer 304
// and polling clients do not re-download the full document after max-age.
var (
	openAPIDocumentBytes []byte
	openAPIDocumentETag  string
)

func init() {
	raw, err := io.ReadAll(openapibundled.Reader())
	if err != nil {
		panic("openapi document: read embed: " + err.Error())
	}
	var compact bytes.Buffer
	if err := json.Compact(&compact, raw); err != nil {
		panic("openapi document: compact: " + err.Error())
	}
	openAPIDocumentBytes = compact.Bytes()
	sum := sha256.Sum256(openAPIDocumentBytes)
	openAPIDocumentETag = `"sha256-` + hex.EncodeToString(sum[:]) + `"`
}

// openAPIDocumentHandler serves the OpenAPI document this binary embeds.
// Mounted by MountAPI outside the ogen/auth chain so discovery needs no
// session; observe middleware still gives it a request ID and access log.
// CORS * (and OPTIONS) is for cross-origin tools that send Authorization.
func openAPIDocumentHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		switch r.Method {
		case http.MethodOptions:
			w.Header().Set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "*")
			w.Header().Set("Access-Control-Max-Age", "86400")
			w.WriteHeader(http.StatusNoContent)
			return
		case http.MethodGet, http.MethodHead:
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Cache-Control", "public, max-age=300")
			w.Header().Set("ETag", openAPIDocumentETag)
			http.ServeContent(w, r, "openapi.json", time.Time{}, bytes.NewReader(openAPIDocumentBytes))
		default:
			w.Header().Set("Allow", "GET, HEAD, OPTIONS")
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
		}
	})
}
