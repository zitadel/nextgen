// Package oauth is a proof of concept of the platform project's OAuth 2.1
// authorization server (ADR 082): the `zitadel` CLI and MCP clients sign a
// developer in through one app that Zitadel declares in code, and the
// management API and /mcp accept the tokens it issues as a user bearer
// (ADR 053 §5).
//
// It is deliberately small: one project (the platform project), public
// clients only, the authorization code grant with PKCE and rotating refresh
// tokens, client ID metadata documents and stateless dynamic registration.
// zitadel/oidc's op.Server answers the back channel (tokenendpoint.go).
package oauth

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// Users reads a signed-in user's own record (service.UserService).
type Users interface {
	GetMyUser(ctx context.Context, input service.GetMyUserInput) (*domain.User, error)
}

// Deps are what New wires the server to.
type Deps struct {
	Config Config
	// PublicBase is the deployment's public base, `server.public_base`: the
	// issuer and the API identifiers hang off it.
	PublicBase string
	// ConsolePath is where the console is mounted, whose login page answers
	// the requests (`server.console_path`).
	ConsolePath string
	// ProjectID is the platform project, the issuer's project.
	ProjectID string
	// App is the platform project's built-in app, PlatformApp's when nil;
	// Apps serves it beside the project's stored apps.
	App *domain.ResolvedApp
	// Apps finds the clients and APIs a request names.
	Apps service.AppDirectory
	// Registrations keeps the clients that register themselves.
	Registrations service.ClientRegistrationService
	Keys          service.KeyService
	Users         Users
	Consents      service.ConsentService
	// Fetch is the hardened egress client client ID metadata documents are
	// fetched with.
	Fetch *http.Client
	Now   func() time.Time
}

// Server is the platform project's authorization server.
type Server struct {
	cfg           Config
	app           *domain.ResolvedApp
	projectID     string
	publicBase    *url.URL
	issuer        string
	consolePath   string
	apps          service.AppDirectory
	registrations service.ClientRegistrationService
	keys          service.KeyService
	users         Users
	consents      service.ConsentService
	documents     *documentCache
	backChannel   http.Handler
	now           func() time.Time
	// publicJWKs holds each signing key's public half by key id.
	publicJWKs sync.Map
}

// New builds the server, or fails on a configuration it cannot serve.
func New(deps Deps) (*Server, error) {
	if deps.ProjectID == "" {
		return nil, errors.New("platform.oauth needs a platform project: set platform.bootstrap_project")
	}
	base, err := url.Parse(strings.TrimRight(deps.PublicBase, "/"))
	if err != nil || base.Scheme == "" || base.Host == "" {
		return nil, errors.New("platform.oauth needs server.public_base to be an absolute URL")
	}
	if base.Path != "" {
		// The RFC 8414 and RFC 9728 well-known paths sit at the host's root,
		// which a server mounted under a path does not answer.
		return nil, errors.New("platform.oauth needs server.public_base without a path")
	}
	now := deps.Now
	if now == nil {
		now = time.Now
	}
	cfg := deps.Config.withDefaults()
	app := deps.App
	if app == nil {
		app = PlatformApp(deps.ProjectID, base.String(), cfg)
	}
	for _, api := range app.Document.APIs {
		if !slices.Contains(apiSigningAlgorithms, signingAlgorithm(api)) {
			return nil, fmt.Errorf("platform.oauth cannot sign the %s API's tokens with %s", api.Slug, api.SigningAlg)
		}
	}
	if deps.Apps == nil || deps.Registrations == nil {
		return nil, errors.New("platform.oauth needs the app directory and the client registrations")
	}
	// The built-in app answers without a read, so this costs nothing.
	if found, _, err := deps.Apps.Client(context.Background(), service.AppLookup{ProjectID: deps.ProjectID}, CLIClientID); err != nil || found.Slug != app.Slug {
		return nil, errors.New("platform.oauth needs an app directory that serves the platform project's built-in app")
	}
	s := &Server{
		cfg:           cfg,
		app:           app,
		projectID:     deps.ProjectID,
		publicBase:    base,
		consolePath:   strings.TrimRight(deps.ConsolePath, "/"),
		apps:          deps.Apps,
		registrations: deps.Registrations,
		keys:          deps.Keys,
		users:         deps.Users,
		consents:      deps.Consents,
		documents:     newDocumentCache(deps.Fetch, now),
		now:           now,
	}
	// The console is served on the server's domain, so that domain is the
	// platform project's issuer (ADR 081 §5).
	s.issuer = base.String()
	s.backChannel = s.newBackChannel()
	return s, nil
}

// api is one of the built-in app's APIs, by slug.
func (s *Server) api(slug string) (domain.AppAPI, bool) {
	i := slices.IndexFunc(s.app.Document.APIs, func(api domain.AppAPI) bool { return api.Slug == slug })
	if i < 0 {
		return domain.AppAPI{}, false
	}
	return s.app.Document.APIs[i], true
}

// Issuer is the issuer identifier: the origin the console is served on,
// which it shares with the server (ADR 081 §5).
func (s *Server) Issuer() string { return s.issuer }

// namespace is where the platform project's endpoints live on the server,
// `/oauth/<project id>` (ADR 081 §6).
func (s *Server) namespace() string { return "/oauth/" + s.projectID }

func (s *Server) url(path string) string {
	u := *s.publicBase
	u.Path = path
	return u.String()
}
