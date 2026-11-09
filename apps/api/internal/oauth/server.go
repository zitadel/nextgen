package oauth

import (
	"net/http"
	"net/url"

	"github.com/rs/cors"
	"github.com/zitadel/oidc/v3/pkg/oidc"
	"github.com/zitadel/oidc/v3/pkg/op"

	"github.com/zitadel/nextgen/internal/httputil"
)

// Config builds the handlers of the OAuth server.
type Config struct {
	// PublicBase is the server's own address; its origin hosts the
	// back-channel endpoints of every issuer.
	PublicBase *url.URL
	// PlatformEnabled says whether the deployment has a platform project,
	// whose issuer is the empty tenant.
	PlatformEnabled bool
	Admission       Admission
	Settings        SettingsSource
}

// Handlers are the two handlers of the OAuth server. Metadata answers the
// well-known paths and OP the endpoints; Mount puts both on a mux.
type Handlers struct {
	Metadata *op.MetadataHandler
	OP       http.Handler
}

// server holds what the issuer middleware shares between the handlers.
type server struct {
	platformEnabled bool
	admission       Admission
}

// opServer is the OP behind the endpoints. It answers the library's 404 at
// every endpoint until they are implemented.
type opServer struct {
	op.UnimplementedServer
}

// New builds the handlers. Both take the same tenant prefix and the same
// issuer middleware, so a request to an issuer's well-known path and one
// to its endpoints derive the same issuer.
func New(cfg Config) *Handlers {
	s := &server{platformEnabled: cfg.PlatformEnabled, admission: cfg.Admission}
	metadata := op.RegisterMetadataServer(
		metadataServer{settings: cfg.Settings, endpoints: NewEndpointFactory(cfg.PublicBase)},
		op.WithTenantPrefix(Prefix),
		op.WithHTTPMiddleware(httputil.WithForwardedNoStore, s.withIssuer),
		op.WithServerCORSOptions(corsOptions()),
	)
	opHandler := op.RegisterServer(opServer{}, opEndpoints(),
		op.WithTenantPrefix(Prefix),
		op.WithHTTPMiddleware(s.withIssuer),
		op.WithServerCORSOptions(corsOptions()),
	)
	return &Handlers{Metadata: metadata, OP: opHandler}
}

// Mount registers the handlers on mux, each through wrap. Every pattern is
// explicit, so a root catch-all registered beside them does not swallow
// them: the well-known paths of RFC 8414 at the root, the OpenID Connect
// Discovery form under each issuer, and the endpoints under Prefix. The OP
// handler receives the full path and strips the tenant itself.
func (h *Handlers) Mount(mux *http.ServeMux, wrap func(http.Handler) http.Handler) {
	metadata := wrap(h.Metadata)
	mux.Handle("/.well-known/", metadata)
	mux.Handle(Prefix+"/{tenant}"+oidc.DiscoveryEndpoint, metadata)
	mux.Handle(Prefix+oidc.DiscoveryEndpoint, metadata)
	mux.Handle(Prefix+"/", wrap(h.OP))
}

// corsOptions let a browser on any origin read the metadata and call the
// endpoints without credentials (ADR 081 §6): the public client's requests
// carry no cookie, and the confidential client's never come from a
// browser.
func corsOptions() *cors.Options {
	return &cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowCredentials: false,
		AllowedMethods:   []string{http.MethodGet, http.MethodHead, http.MethodPost, http.MethodOptions},
		AllowedHeaders:   []string{"Authorization", "Content-Type"},
	}
}
