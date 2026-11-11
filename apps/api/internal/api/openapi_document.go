package api

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	openapibundled "github.com/zitadel/nextgen/api/openapi/bundled"
)

// Compacted embed + strong ETag, computed once so ServeContent can answer 304
// and polling clients do not re-download the full document after max-age.
// The gzip twin is about a seventh of the size; the server compresses no other
// response, so this one carries its own. Each encoding is its own
// representation and so gets its own strong ETag.
var (
	openAPIDocumentBytes    []byte
	openAPIDocumentETag     string
	openAPIDocumentGzip     []byte
	openAPIDocumentGzipETag string
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

	var gz bytes.Buffer
	zw, err := gzip.NewWriterLevel(&gz, gzip.BestCompression)
	if err != nil {
		panic("openapi document: gzip: " + err.Error())
	}
	if _, err := zw.Write(openAPIDocumentBytes); err != nil {
		panic("openapi document: gzip: " + err.Error())
	}
	if err := zw.Close(); err != nil {
		panic("openapi document: gzip: " + err.Error())
	}
	openAPIDocumentGzip = gz.Bytes()
	openAPIDocumentGzipETag = `"sha256-` + hex.EncodeToString(sum[:]) + `-gzip"`
}

// acceptsGzip reports whether an Accept-Encoding header admits gzip: listed
// (or "*") without q=0.
func acceptsGzip(header string) bool {
	for _, part := range strings.Split(header, ",") {
		coding, params, _ := strings.Cut(part, ";")
		coding = strings.ToLower(strings.TrimSpace(coding))
		if coding != "gzip" && coding != "*" {
			continue
		}
		if weight, ok := strings.CutPrefix(strings.TrimSpace(params), "q="); ok {
			if q, err := strconv.ParseFloat(strings.TrimSpace(weight), 64); err == nil && q == 0 {
				return false
			}
		}
		return true
	}
	return false
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
			w.Header().Set("Vary", "Accept-Encoding")
			body, etag := openAPIDocumentBytes, openAPIDocumentETag
			if acceptsGzip(r.Header.Get("Accept-Encoding")) {
				body, etag = openAPIDocumentGzip, openAPIDocumentGzipETag
				w.Header().Set("Content-Encoding", "gzip")
			}
			w.Header().Set("ETag", etag)
			http.ServeContent(w, r, "openapi.json", time.Time{}, bytes.NewReader(body))
		default:
			w.Header().Set("Allow", "GET, HEAD, OPTIONS")
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
		}
	})
}
