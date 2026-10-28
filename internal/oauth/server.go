// Package oauth is a proof of concept of the platform project's OAuth 2.1
// authorization server (ADR 082): the `zitadel` CLI and MCP clients sign a
// developer in through one app that Zitadel declares in code, and the
// management API and /mcp accept the tokens it issues as a user bearer
// (ADR 053 §5).
//
// It is deliberately small: one project (the platform project), public
// clients only, the authorization code grant with PKCE and rotating refresh
// tokens, client ID metadata documents and stateless dynamic registration.
package oauth

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// Sessions reads the browser session a sign-in left: the console's
// __nextgen_session cookie (service.TokenService).
type Sessions interface {
	IntrospectToken(ctx context.Context, token string) (*domain.Token, error)
}

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
	// ConsolePath is where the console is mounted, whose login page signs
	// the developer in (`server.console_path`).
	ConsolePath string
	// ProjectID is the platform project, the issuer's project.
	ProjectID string
	Keys      service.KeyService
	Sessions  Sessions
	Users     Users
	Grants    service.OAuthGrantService
	// Fetch is the hardened egress client client ID metadata documents are
	// fetched with.
	Fetch *http.Client
	Now   func() time.Time
}

// Server is the platform project's authorization server.
type Server struct {
	cfg         Config
	app         App
	projectID   string
	publicBase  *url.URL
	issuer      string
	consolePath string
	keys        service.KeyService
	sessions    Sessions
	users       Users
	grants      service.OAuthGrantService
	documents   *documentCache
	now         func() time.Time
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
	s := &Server{
		cfg:         cfg,
		app:         PlatformApp(base.String(), cfg),
		projectID:   deps.ProjectID,
		publicBase:  base,
		consolePath: strings.TrimRight(deps.ConsolePath, "/"),
		keys:        deps.Keys,
		sessions:    deps.Sessions,
		users:       deps.Users,
		grants:      deps.Grants,
		documents:   newDocumentCache(deps.Fetch, now),
		now:         now,
	}
	s.issuer = s.url(s.issuerPath())
	return s, nil
}

// App is the app this server serves, for its callers to describe.
func (s *Server) App() App { return s.app }

// Issuer is the issuer identifier, `<public base>/oauth/<project id>`, the
// namespace ADR 081 §6 reserves for a project's authorization server.
func (s *Server) Issuer() string { return s.issuer }

func (s *Server) issuerPath() string { return "/oauth/" + s.projectID }

func (s *Server) url(path string) string {
	u := *s.publicBase
	u.Path = path
	return u.String()
}
