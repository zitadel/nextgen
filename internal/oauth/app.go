package oauth

import (
	"slices"
	"strings"
	"time"
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
}

const (
	defaultAccessTokenTTL  = 5 * time.Minute
	defaultRefreshTokenTTL = 14 * 24 * time.Hour
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
	return c
}

// The platform project's app and the names the CLI compiles in.
const (
	AppSlug         = "zitadel"
	CLIClientID     = "cli"
	PlatformAPISlug = "platform"
	MCPAPISlug      = "mcp"
)

// App is one piece of software that uses Zitadel, with the configs it holds
// (identity model, PR #2445): its clients, the APIs it serves, and whether
// other clients may register into it.
type App struct {
	Slug         string
	Name         string
	Clients      []Client
	APIs         []API
	Registration Registration
}

// ClientSource is where a client's definition comes from.
type ClientSource string

const (
	// SourceApp is a client the app document declares.
	SourceApp ClientSource = "app"
	// SourceMetadataDocument is a client whose client_id is the URL of its
	// client ID metadata document.
	SourceMetadataDocument ClientSource = "metadata_document"
	// SourceRegistered is a client that registered through RFC 7591.
	SourceRegistered ClientSource = "registered"
)

// Client is an OAuth client of the app. Every client here is public: it
// proves itself with PKCE, never a secret.
type Client struct {
	ID     string
	Name   string
	Source ClientSource
	// FirstParty clients skip consent (ADR 082 §3). Only the app's own are.
	FirstParty bool
	// RedirectURIs match exactly, except that a loopback one matches on any
	// port (RFC 8252 §7.3).
	RedirectURIs []string
	// APIs are the slugs of the APIs this client may get a token for, its
	// default resource first. Empty for a third-party client: it may request
	// the APIs open to third parties.
	APIs []string
}

// API is something the app serves: its identifier is the `aud` of every
// token for it, one API per token (RFC 8707).
type API struct {
	Slug       string
	Name       string
	Identifier string
	// Scopes the API defines on top of the built-in ones.
	Scopes []string
	// ThirdParty APIs may be requested by clients that registered themselves
	// (ADR 082 §5); the user consents to each such client.
	ThirdParty bool
}

// Registration says how clients may join the app on their own.
type Registration struct {
	ClientIDMetadataDocuments bool
	Dynamic                   bool
}

// builtinScopes are the scopes every API accepts (ADR 082 §5). offline_access
// is what a third-party client asks for to get a refresh token (ADR 082 §2).
var builtinScopes = []string{"openid", "profile", "email", "offline_access"}

// cliRedirectURIs are the loopback callbacks the CLI listens on, any port.
var cliRedirectURIs = []string{
	"http://127.0.0.1/callback",
	"http://[::1]/callback",
	"http://localhost/callback",
}

// PlatformApp is Zitadel's own app in the platform project: the CLI as a
// first-party client, the management API and the MCP server it serves, and
// open registration for MCP clients when the operator turns it on. Its API
// identifiers follow the deployment's public base.
func PlatformApp(publicBase string, cfg Config) App {
	base := strings.TrimRight(publicBase, "/")
	return App{
		Slug: AppSlug,
		Name: "Zitadel",
		Clients: []Client{{
			ID:           CLIClientID,
			Name:         "Zitadel CLI",
			Source:       SourceApp,
			FirstParty:   true,
			RedirectURIs: cliRedirectURIs,
			APIs:         []string{PlatformAPISlug, MCPAPISlug},
		}},
		APIs: []API{
			{Slug: PlatformAPISlug, Name: "Zitadel API", Identifier: base},
			{Slug: MCPAPISlug, Name: "Zitadel MCP server", Identifier: base + "/mcp", ThirdParty: true},
		},
		Registration: Registration{
			ClientIDMetadataDocuments: cfg.ClientIDMetadataDocuments,
			Dynamic:                   cfg.DynamicRegistration,
		},
	}
}

func (a App) client(id string) (Client, bool) {
	i := slices.IndexFunc(a.Clients, func(c Client) bool { return c.ID == id })
	if i < 0 {
		return Client{}, false
	}
	return a.Clients[i], true
}

func (a App) api(slug string) (API, bool) {
	i := slices.IndexFunc(a.APIs, func(api API) bool { return api.Slug == slug })
	if i < 0 {
		return API{}, false
	}
	return a.APIs[i], true
}

func (a App) apiByIdentifier(identifier string) (API, bool) {
	i := slices.IndexFunc(a.APIs, func(api API) bool { return api.Identifier == identifier })
	if i < 0 {
		return API{}, false
	}
	return a.APIs[i], true
}

// allowedAPIs are the APIs c may get a token for, its default first.
func (a App) allowedAPIs(c Client) []API {
	if c.Source == SourceApp {
		apis := make([]API, 0, len(c.APIs))
		for _, slug := range c.APIs {
			if api, ok := a.api(slug); ok {
				apis = append(apis, api)
			}
		}
		return apis
	}
	var apis []API
	for _, api := range a.APIs {
		if api.ThirdParty {
			apis = append(apis, api)
		}
	}
	return apis
}

// resource picks the API a request names with `resource`, or c's default
// when it names none. A client may only name an API it is allowed.
func (a App) resource(c Client, requested string) (API, bool) {
	allowed := a.allowedAPIs(c)
	if len(allowed) == 0 {
		return API{}, false
	}
	if requested == "" {
		return allowed[0], true
	}
	i := slices.IndexFunc(allowed, func(api API) bool { return api.Identifier == requested })
	if i < 0 {
		return API{}, false
	}
	return allowed[i], true
}

// grantedScopes is what of the requested scopes the API supports: the rest
// are dropped, as RFC 6749 §3.3 lets a server do, and the token response says
// what was granted.
func grantedScopes(api API, requested []string) []string {
	var granted []string
	for _, scope := range requested {
		if (slices.Contains(builtinScopes, scope) || slices.Contains(api.Scopes, scope)) && !slices.Contains(granted, scope) {
			granted = append(granted, scope)
		}
	}
	return granted
}

func (a App) scopesSupported(api API) []string {
	return append(slices.Clone(builtinScopes), api.Scopes...)
}
