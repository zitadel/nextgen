package api

import (
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"time"

	"go.opentelemetry.io/otel/attribute"

	"github.com/zitadel/nextgen/api/client"
	api "github.com/zitadel/nextgen/api/generated"
)

// Router is a generated server as MountAPI mounts it: it serves a request,
// and it tells which operation a request names.
type Router interface {
	http.Handler
	FindPath(method string, u *url.URL) (api.Route, bool)
}

// Servers are the mounts of the resource API (ADR 077): one handler,
// served by a generated server per mount.
type Servers struct {
	// API answers every operation under client.PathPrefix.
	API Router
	// Probes answers the health probes at the root, which stays their home
	// for good.
	Probes Router
	// Root answers every operation at its root path until 1.0.0, and marks
	// its spans and metrics with RootPathAttribute.
	Root Router
}

// RootPathAttribute marks the spans and metrics of an operation a request
// reached at its root path, through the alias that answers there until 1.0.0
// (ADR 077 §4). GA removes the alias once the traffic it marks has died down.
var RootPathAttribute = attribute.Bool("zitadel.api.root_path", true)

// probePaths are the paths of the health probes, where orchestrators look for
// them.
var probePaths = []string{"/livez", "/readyz"}

// NewServers builds the API's servers over one handler and security
// handler, each with opts and what makes it its mount.
func NewServers(h api.Handler, sec api.SecurityHandler, opts ...api.ServerOption) (Servers, error) {
	build := func(mount ...api.ServerOption) (Router, error) {
		server, err := api.NewServer(h, sec, append(slices.Clip(opts), mount...)...)
		if err != nil {
			return nil, err
		}
		return server, nil
	}
	prefixed, err := build(api.WithPathPrefix(client.PathPrefix))
	if err != nil {
		return Servers{}, err
	}
	probes, err := build()
	if err != nil {
		return Servers{}, err
	}
	root, err := build(api.WithAttributes(RootPathAttribute))
	if err != nil {
		return Servers{}, err
	}
	return Servers{API: prefixed, Probes: probes, Root: root}, nil
}

// MountAPI mounts servers on mux, each behind chain. The API answers under
// client.PathPrefix, and at the bare prefix too, so that a request for it
// gets the API's not-found answer rather than the mux's redirect. The probes
// answer at their root paths, and the root alias takes every other path:
// mounts registered on mux for paths of their own, the console's and the IdP
// callbacks', win over it.
func MountAPI(mux *http.ServeMux, chain func(http.Handler) http.Handler, servers Servers) {
	prefixed := chain(servers.API)
	mux.Handle(client.PathPrefix+"/", prefixed)
	mux.Handle(client.PathPrefix, prefixed)
	probes := chain(servers.Probes)
	for _, path := range probePaths {
		mux.Handle(path, probes)
	}
	mux.Handle("/", chain(withRootPathDeprecation(servers.Root)))
}

// rootPathDeprecatedSince is the day the API moved under client.PathPrefix,
// the date the Deprecation header names.
//
// TODO(ADR 077): the date of the release that ships the prefix; this one
// holds its place.
var rootPathDeprecatedSince = time.Date(2026, time.October, 25, 0, 0, 0, 0, time.UTC)

// rootPathDeprecationDocs is the page the Link of a deprecated response
// points at: the API reference's section on the base URL.
const rootPathDeprecationDocs = "https://preview.zitadel.com/docs/reference/api#base-url"

var (
	// A structured-field date: @ and the seconds since the epoch (RFC 9745 §2).
	rootPathDeprecation     = "@" + strconv.FormatInt(rootPathDeprecatedSince.Unix(), 10)
	rootPathDeprecationLink = "<" + rootPathDeprecationDocs + `>; rel="deprecation"; type="text/html"`
)

// withRootPathDeprecation marks the response root gives an operation as
// deprecated (ADR 077 §4, RFC 9745): a Deprecation header with the day the
// API moved, and a Link to the docs on the base URL. No Sunset until GA has a
// date. A request that names no operation, a path the API lacks or a method
// its path does not take, gets neither: it is no API path that moved. The
// probes never reach root here: MountAPI mounts them on their own.
func withRootPathDeprecation(root Router) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, ok := root.FindPath(r.Method, r.URL); ok {
			w.Header().Set("Deprecation", rootPathDeprecation)
			w.Header().Add("Link", rootPathDeprecationLink)
		}
		root.ServeHTTP(w, r)
	})
}
