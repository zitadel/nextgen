package api

import (
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/ogen-go/ogen/uri"

	"github.com/zitadel/nextgen/api/client"
	api "github.com/zitadel/nextgen/internal/api/generated"
)

// legacyFlowPathDeprecatedSince is the day the flow operations moved from
// `/flow` to `/flows`, the date the Deprecation header of a request on the old
// path names.
//
// TODO(ADR 077): the date of the release that ships `/flows`; this one holds
// its place.
var legacyFlowPathDeprecatedSince = time.Date(2026, time.November, 13, 0, 0, 0, 0, time.UTC)

// legacyFlowPathDocs is the page the Link of such a response points at: the
// API reference on flows.
const legacyFlowPathDocs = client.DocsOrigin + "/docs/reference/api/flows"

const (
	// legacyFlowCollection is where the flow operations lived, the only
	// singular collection the API had.
	legacyFlowCollection = "/flow"
	flowCollection       = "/flows"
)

var (
	// A structured-field date: @ and the seconds since the epoch (RFC 9745 §2).
	legacyFlowPathDeprecation = "@" + strconv.FormatInt(legacyFlowPathDeprecatedSince.Unix(), 10)
	legacyFlowPathLink        = "<" + legacyFlowPathDocs + `>; rel="deprecation"; type="text/html"`
)

// withLegacyFlowPath lets the flow operations answer at `/flow`, where the
// login component and every SDK released before the collection became
// `/flows` call them (ADR 077 §4): `POST /flow` is createFlow,
// `GET /flow/{flow_id}` getFlowStep and `POST /flow/{flow_id}/submit`
// submitFlowStep, under client.PathPrefix and at the root. Its answer for an
// operation says the path is deprecated (RFC 9745) with a Link to the docs,
// as the root path alias's does, and the path is answered until 1.0.0 as
// that alias is. A path or a method that names no operation there gets the
// answer `/flows` gives it and neither header. Any other request reaches
// next untouched.
//
// It maps the path for FindPath too, so a wrapper around it sees the
// operation a request on the old path names.
func withLegacyFlowPath(next Router) Router {
	return legacyFlowPathRouter{next}
}

type legacyFlowPathRouter struct{ Router }

func (l legacyFlowPathRouter) FindPath(method string, u *url.URL) (api.Route, bool) {
	if target, ok := LegacyFlowPathTarget(u); ok {
		u = target
	}
	return l.Router.FindPath(method, u)
}

func (l legacyFlowPathRouter) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	target, ok := LegacyFlowPathTarget(r.URL)
	if !ok {
		l.Router.ServeHTTP(w, r)
		return
	}
	if _, ok := l.Router.FindPath(r.Method, target); ok {
		// The root path alias may have named its own, earlier, date.
		if w.Header().Get("Deprecation") == "" {
			w.Header().Set("Deprecation", legacyFlowPathDeprecation)
		}
		w.Header().Add("Link", legacyFlowPathLink)
	}
	// A copy, so the middleware around this router keeps the path the client
	// sent: the access log's line tells how much traffic the old path takes.
	served := r.WithContext(r.Context())
	served.URL = target
	l.Router.ServeHTTP(w, served)
}

// LegacyFlowPathTarget is u at the path the flow operations live at now, when
// u names their old collection or a path below it: `/flow/flow_1/submit` is
// `/flows/flow_1/submit`. It reads the path as the generated router does: the
// escaped one when u carries it, normalized the same way, so `/%66low` is
// `/flow` here as it is there, and `/flow%2Fx` is one segment that is not.
func LegacyFlowPathTarget(u *url.URL) (*url.URL, bool) {
	target := *u
	if escaped, ok := routedEscapedPath(u); ok {
		raw, ok := flowsPath(escaped)
		if !ok {
			return nil, false
		}
		path, err := url.PathUnescape(raw)
		if err != nil {
			return nil, false
		}
		target.Path, target.RawPath = path, raw
		return &target, true
	}
	path, ok := flowsPath(u.Path)
	if !ok {
		return nil, false
	}
	target.Path = path
	return &target, true
}

// routedEscapedPath is the escaped path the generated router routes u by,
// when it routes by one: u's own, with the escapes no path needs undone. A
// URL without an escaped path, or with one that does not parse, is routed by
// its path.
func routedEscapedPath(u *url.URL) (string, bool) {
	if u.RawPath == "" {
		return "", false
	}
	return uri.NormalizeEscapedPath(u.RawPath)
}

// flowsPath is path with the old flow collection spelled as the new one, when
// path is that collection or below it, under client.PathPrefix or at the
// root. It matches whole segments: `/flow_definitions` and `/flows` are no
// paths of the old collection.
func flowsPath(path string) (string, bool) {
	prefix := ""
	if rest, ok := strings.CutPrefix(path, client.PathPrefix); ok && strings.HasPrefix(rest, "/") {
		prefix, path = client.PathPrefix, rest
	}
	below, ok := strings.CutPrefix(path, legacyFlowCollection)
	if !ok || (below != "" && below[0] != '/') {
		return "", false
	}
	return prefix + flowCollection + below, true
}
