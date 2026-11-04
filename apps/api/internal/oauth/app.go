package oauth

import (
	"slices"
	"strings"
	"time"

	"github.com/go-jose/go-jose/v4"

	"github.com/zitadel/nextgen/api/client"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// Config holds what an operator may set on the platform project's
// authorization server. The app it serves is code ([PlatformApp]): it changes
// with server versions, and no API edits it.
type Config struct {
	// Enabled serves the authorization server, its metadata, the platform
	// API's user bearer and /mcp. It needs a platform project.
	Enabled bool `mapstructure:"enabled"`
	// AccessTokenTTL is how long an access token lives (ADR 037: minutes).
	AccessTokenTTL time.Duration `mapstructure:"access_token_ttl"`
	// RefreshTokenTTL is how long a refresh token lives once issued or
	// rotated (ADR 037: two weeks).
	RefreshTokenTTL time.Duration `mapstructure:"refresh_token_ttl"`
	// ClientIDMetadataDocuments lets a client use an HTTPS URL as its
	// client_id, the document behind it saying who it is (ADR 082 §9).
	ClientIDMetadataDocuments bool `mapstructure:"client_id_metadata_documents"`
	// DynamicRegistration serves RFC 7591 registration (ADR 082 §9).
	DynamicRegistration bool `mapstructure:"dynamic_registration"`
	// ConsentLifetime is how long a user's consent to a client lasts, however
	// often it is used (ADR 072's absolute lifetime).
	ConsentLifetime time.Duration `mapstructure:"consent_lifetime"`
}

// ConsentLifetimes bound a consent: its own lifetime, and the refresh token's
// as its idle timeout, since a consent unused for longer has no token left
// to use it with.
func (c Config) ConsentLifetimes() service.ConsentLifetimes {
	c = c.withDefaults()
	return service.ConsentLifetimes{Lifetime: c.ConsentLifetime, IdleTimeout: c.RefreshTokenTTL}
}

const (
	defaultAccessTokenTTL  = 5 * time.Minute
	defaultRefreshTokenTTL = 14 * 24 * time.Hour
	defaultConsentLifetime = 90 * 24 * time.Hour
	codeTTL                = time.Minute
	requestTTL             = 10 * time.Minute
)

func (c Config) withDefaults() Config {
	if c.AccessTokenTTL <= 0 {
		c.AccessTokenTTL = defaultAccessTokenTTL
	}
	if c.RefreshTokenTTL <= 0 {
		c.RefreshTokenTTL = defaultRefreshTokenTTL
	}
	if c.ConsentLifetime <= 0 {
		c.ConsentLifetime = defaultConsentLifetime
	}
	return c
}

// The platform project's app and the names the CLI compiles in.
const (
	AppSlug         = "zitadel"
	CLIClientID     = "cli"
	PlatformAPISlug = "platform"
	MCPAPISlug      = "mcp"
)

// cliRedirectURIs are the loopback callbacks the CLI listens on, any port.
var cliRedirectURIs = []string{
	"http://127.0.0.1/callback",
	"http://[::1]/callback",
	"http://localhost/callback",
}

// PlatformApp is Zitadel's own app in the platform project, the one the
// server declares itself: the CLI as a first-party client, the management
// API and the MCP server it serves, and registration for MCP clients as the
// operator opens it. The app directory serves it beside the project's stored
// apps. Its API identifiers follow the deployment's public base: the
// management API's is the base the API answers under (client.PathPrefix, ADR
// 077).
func PlatformApp(projectID, publicBase string, cfg Config) *domain.ResolvedApp {
	base := strings.TrimRight(publicBase, "/")
	return &domain.ResolvedApp{
		ProjectID: projectID,
		Slug:      AppSlug,
		Source:    domain.AppSourceBuiltin,
		Document: domain.AppDocument{
			Slug: AppSlug,
			Name: "Zitadel",
			Clients: []domain.AppClient{{
				Slug:         CLIClientID,
				Name:         "Zitadel CLI",
				ClientID:     CLIClientID,
				Type:         domain.ClientTypePublic,
				GrantTypes:   []domain.GrantType{domain.GrantAuthorizationCode, domain.GrantRefreshToken},
				RedirectURIs: cliRedirectURIs,
				APIs:         []domain.ClientAPI{{API: PlatformAPISlug}, {API: MCPAPISlug}},
			}},
			APIs: []domain.AppAPI{
				{Slug: PlatformAPISlug, Name: "Zitadel API", Identifier: base + client.PathPrefix},
				{Slug: MCPAPISlug, Name: "Zitadel MCP server", Identifier: base + "/mcp", ThirdParty: true},
			},
			Registration: domain.AppRegistration{
				ClientIDMetadataDocuments: cfg.ClientIDMetadataDocuments,
				Dynamic:                   cfg.DynamicRegistration,
			},
		},
	}
}

// defaultSigningAlgorithm signs the tokens of an API that chooses none.
// OpenID Connect Discovery requires it for ID tokens, and every JWT library
// verifies it.
const defaultSigningAlgorithm = jose.RS256

// apiSigningAlgorithms are the algorithms an API may choose (ADR 082 §7).
var apiSigningAlgorithms = []jose.SignatureAlgorithm{jose.RS256, jose.ES256}

// signingAlgorithm signs api's access tokens: RS256 unless the API chose
// ES256.
func signingAlgorithm(api domain.AppAPI) jose.SignatureAlgorithm {
	if api.SigningAlg == "" {
		return defaultSigningAlgorithm
	}
	return jose.SignatureAlgorithm(api.SigningAlg)
}

// scopesSupported are the scopes a token for api may carry: the built-in
// ones and the API's own, which its RFC 9728 metadata lists. A client such as
// Claude Code asks for every scope listed, and a scope the API does not take
// is refused (ADR 082 §5), so the list is exactly what the API takes.
func scopesSupported(api domain.AppAPI) []string {
	return append(slices.Clone(domain.BuiltinScopes), api.ScopeNames()...)
}
