package oauth

import (
	"net/http"
	"net/url"
	"strings"

	"github.com/zitadel/nextgen/internal/domain"
)

// Route is one path the server's mux hands to this package.
type Route struct {
	Pattern string
	Handler http.Handler
}

// Routes are the paths the authorization server, the protected-resource
// metadata and /mcp answer. The mux mounts each behind the API's request
// middleware.
func (s *Server) Routes() []Route {
	ns := s.namespace()
	metadata := cors(http.HandlerFunc(s.serveMetadata))
	back := cors(s.backChannel)
	return []Route{
		// The issuer is the domain the console shares with the server, so its
		// metadata sits at the root (RFC 8414 §3), and also at the path ADR
		// 081 §6 fixes for a project's.
		{"GET /.well-known/oauth-authorization-server", metadata},
		{"OPTIONS /.well-known/oauth-authorization-server", metadata},
		{"GET " + ns + "/.well-known/oauth-authorization-server", metadata},
		{"OPTIONS " + ns + "/.well-known/oauth-authorization-server", metadata},
		{"GET " + ns + "/authorize", http.HandlerFunc(s.authorize)},
		{"GET " + ns + "/jwks", back},
		{"OPTIONS " + ns + "/jwks", back},
		{"POST " + ns + "/token", back},
		{"OPTIONS " + ns + "/token", back},
		{"POST " + ns + "/revoke", back},
		{"OPTIONS " + ns + "/revoke", back},
		{"POST " + ns + "/register", cors(http.HandlerFunc(s.serveRegister))},
		{"OPTIONS " + ns + "/register", cors(http.HandlerFunc(s.serveRegister))},
		// RFC 9728 §3.1: each API's metadata with the API's path inserted.
		{"GET " + s.resourceMetadataPath(PlatformAPISlug), cors(s.serveResourceMetadata(PlatformAPISlug))},
		{"OPTIONS " + s.resourceMetadataPath(PlatformAPISlug), cors(s.serveResourceMetadata(PlatformAPISlug))},
		{"GET " + s.resourceMetadataPath(MCPAPISlug), cors(s.serveResourceMetadata(MCPAPISlug))},
		{"OPTIONS " + s.resourceMetadataPath(MCPAPISlug), cors(s.serveResourceMetadata(MCPAPISlug))},
		{"/mcp", cors(http.HandlerFunc(s.serveMCP))},
	}
}

// cors lets browser-based clients, MCP Inspector among them, call the
// back-channel endpoints. They take no cookie, so any origin may, without
// credentials (ADR 081 §6).
func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Access-Control-Allow-Origin", "*")
		h.Set("Access-Control-Expose-Headers", "WWW-Authenticate, Mcp-Session-Id")
		if r.Method == http.MethodOptions {
			h.Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
			h.Set("Access-Control-Allow-Headers", "Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID")
			h.Set("Access-Control-Max-Age", "600")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// serveMetadata answers RFC 8414's authorization server metadata. It
// advertises each way to register when any app of the project opens it.
func (s *Server) serveMetadata(w http.ResponseWriter, r *http.Request) {
	open, err := s.apps.Registration(r.Context(), s.lookup())
	if err != nil {
		writeServerFault(w, r, err)
		return
	}
	ns := s.namespace()
	meta := map[string]any{
		"issuer":                                         s.issuer,
		"authorization_endpoint":                         s.url(ns + "/authorize"),
		"token_endpoint":                                 s.url(ns + "/token"),
		"jwks_uri":                                       s.url(ns + "/jwks"),
		"revocation_endpoint":                            s.url(ns + "/revoke"),
		"response_types_supported":                       []string{"code"},
		"response_modes_supported":                       []string{"query"},
		"grant_types_supported":                          []string{"authorization_code", "refresh_token"},
		"code_challenge_methods_supported":               []string{"S256"},
		"token_endpoint_auth_methods_supported":          []string{"none"},
		"revocation_endpoint_auth_methods_supported":     []string{"none"},
		"scopes_supported":                               domain.BuiltinScopes,
		"authorization_response_iss_parameter_supported": true,
		"client_id_metadata_document_supported":          open.ClientIDMetadataDocuments,
	}
	if open.Dynamic {
		meta["registration_endpoint"] = s.url(ns + "/register")
	}
	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, http.StatusOK, meta)
}

func (s *Server) serveRegister(w http.ResponseWriter, r *http.Request) {
	open, err := s.apps.Registration(r.Context(), s.lookup())
	if err != nil {
		writeServerFault(w, r, err)
		return
	}
	if !open.Dynamic {
		http.NotFound(w, r)
		return
	}
	s.register(w, r)
}

// serveResourceMetadata answers RFC 9728's protected resource metadata for
// one of the app's APIs: its identifier, and this server as the one that
// issues its tokens.
func (s *Server) serveResourceMetadata(slug string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		api, _ := s.api(slug)
		writeJSON(w, http.StatusOK, map[string]any{
			"resource":                 api.Identifier,
			"resource_name":            api.Name,
			"authorization_servers":    []string{s.issuer},
			"bearer_methods_supported": []string{"header"},
			"scopes_supported":         scopesSupported(api),
		})
	})
}

// resourceMetadataURL is where an API's RFC 9728 metadata lives, which a 401
// names in WWW-Authenticate (RFC 9728 §5.1).
func (s *Server) resourceMetadataURL(slug string) string {
	return s.url(s.resourceMetadataPath(slug))
}

// resourceMetadataPath inserts the well-known segment before the API's path,
// `/.well-known/oauth-protected-resource/api/v1` for the management API
// (RFC 9728 §3.1).
func (s *Server) resourceMetadataPath(slug string) string {
	api, _ := s.api(slug)
	identifier, _ := url.Parse(api.Identifier)
	return "/.well-known/oauth-protected-resource" + strings.TrimRight(identifier.Path, "/")
}
