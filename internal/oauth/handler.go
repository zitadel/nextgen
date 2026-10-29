package oauth

import (
	"net/http"
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
	issuer := s.issuerPath()
	metadata := cors(http.HandlerFunc(s.serveMetadata))
	return []Route{
		// RFC 8414 §3.1 inserts the well-known segment before the issuer's
		// path; ADR 081 §6 also reserves the appended form under the issuer.
		{"GET /.well-known/oauth-authorization-server" + issuer, metadata},
		{"OPTIONS /.well-known/oauth-authorization-server" + issuer, metadata},
		{"GET " + issuer + "/.well-known/oauth-authorization-server", metadata},
		{"OPTIONS " + issuer + "/.well-known/oauth-authorization-server", metadata},
		{"GET " + issuer + "/jwks", cors(http.HandlerFunc(s.serveJWKS))},
		{"OPTIONS " + issuer + "/jwks", cors(http.HandlerFunc(s.serveJWKS))},
		{"GET " + issuer + "/authorize", http.HandlerFunc(s.authorize)},
		{"POST " + issuer + "/consent", http.HandlerFunc(s.consent)},
		{"POST " + issuer + "/token", cors(http.HandlerFunc(s.token))},
		{"OPTIONS " + issuer + "/token", cors(http.HandlerFunc(s.token))},
		{"POST " + issuer + "/revoke", cors(http.HandlerFunc(s.revoke))},
		{"OPTIONS " + issuer + "/revoke", cors(http.HandlerFunc(s.revoke))},
		{"POST " + issuer + "/register", cors(http.HandlerFunc(s.serveRegister))},
		{"OPTIONS " + issuer + "/register", cors(http.HandlerFunc(s.serveRegister))},
		{"GET " + s.consolePath + continuePath, http.HandlerFunc(s.resume)},
		// RFC 9728 §3.1: the platform API's metadata at the root, the MCP
		// server's with its path inserted.
		{"GET /.well-known/oauth-protected-resource", cors(s.serveResourceMetadata(PlatformAPISlug))},
		{"OPTIONS /.well-known/oauth-protected-resource", cors(s.serveResourceMetadata(PlatformAPISlug))},
		{"GET /.well-known/oauth-protected-resource/mcp", cors(s.serveResourceMetadata(MCPAPISlug))},
		{"OPTIONS /.well-known/oauth-protected-resource/mcp", cors(s.serveResourceMetadata(MCPAPISlug))},
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

// serveMetadata answers RFC 8414's authorization server metadata.
func (s *Server) serveMetadata(w http.ResponseWriter, _ *http.Request) {
	issuer := s.issuer
	meta := map[string]any{
		"issuer":                                         issuer,
		"authorization_endpoint":                         issuer + "/authorize",
		"token_endpoint":                                 issuer + "/token",
		"jwks_uri":                                       issuer + "/jwks",
		"revocation_endpoint":                            issuer + "/revoke",
		"response_types_supported":                       []string{"code"},
		"response_modes_supported":                       []string{"query"},
		"grant_types_supported":                          []string{"authorization_code", "refresh_token"},
		"code_challenge_methods_supported":               []string{"S256"},
		"token_endpoint_auth_methods_supported":          []string{"none"},
		"revocation_endpoint_auth_methods_supported":     []string{"none"},
		"scopes_supported":                               builtinScopes,
		"authorization_response_iss_parameter_supported": true,
		"client_id_metadata_document_supported":          s.app.Registration.ClientIDMetadataDocuments,
	}
	if s.app.Registration.Dynamic {
		meta["registration_endpoint"] = issuer + "/register"
	}
	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, http.StatusOK, meta)
}

func (s *Server) serveJWKS(w http.ResponseWriter, r *http.Request) {
	keys, err := s.publicKeys(r.Context())
	if err != nil {
		writeServerFault(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, keys)
}

func (s *Server) serveRegister(w http.ResponseWriter, r *http.Request) {
	if !s.app.Registration.Dynamic {
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
		api, _ := s.app.api(slug)
		writeJSON(w, http.StatusOK, map[string]any{
			"resource":                 api.Identifier,
			"resource_name":            api.Name,
			"authorization_servers":    []string{s.issuer},
			"bearer_methods_supported": []string{"header"},
			"scopes_supported":         s.app.scopesSupported(api),
		})
	})
}

// resourceMetadataURL is where an API's RFC 9728 metadata lives, which a 401
// names in WWW-Authenticate (RFC 9728 §5.1).
func (s *Server) resourceMetadataURL(slug string) string {
	if slug == PlatformAPISlug {
		return s.url("/.well-known/oauth-protected-resource")
	}
	return s.url("/.well-known/oauth-protected-resource/" + slug)
}
