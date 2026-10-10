package api

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// The identity home.
//
// A region of the cloud is a nextgen of its own, and the people who
// administer projects sign in somewhere else: at the identity home, another
// nextgen that holds their accounts and nothing of any project. The home's
// __nextgen_session cookie reaches a region on the same host, but it is a
// token the home encrypted, so this server cannot introspect it. With
// platform.home.url set it asks the home instead: GET /sessions/me with the
// cookie forwarded, which only a current session of the home answers. The
// answer is cached per process for a short while, so a console page costs
// one round trip to the home, not one per request.
//
// On first sight the home's user is provisioned here, in this deployment's
// platform project, under the home's user id and with the attributes the
// home reports (GET /users/me), and gets its personal team. Grants and
// projects of this region then attach to the same identity the home knows,
// and nothing of the account itself lives here but that shadow.
//
// Past the security boundary the request carries a session token and a
// session synthesized from the home's answer; mySession and
// verifyClaimSession serve those instead of reading a row that does not
// exist here. The CSRF token of ADR 053 §5 keys off the cookie value alone,
// so a region derives the same token as the home would.
//
// This is the remote-validation shape of the two the design note weighs; a
// signed token minted by the home and verified here without the round trip
// can replace the lookup without changing what follows it.

// HomeConfig names the identity home whose sessions this server accepts
// (platform.home). An empty URL means none.
type HomeConfig struct {
	// URL is the home's public base, for example https://cloud.example.
	URL string `mapstructure:"url"`
	// Headers are sent on every request to the home, for a deployment
	// protection bypass or a private route in front of it.
	Headers map[string]string `mapstructure:"headers"`
	// CacheTTL bounds how long a validated cookie is trusted without asking
	// the home again. Default one minute.
	CacheTTL time.Duration `mapstructure:"cache_ttl"`
	// Timeout is the request timeout for the home. Default five seconds.
	Timeout time.Duration `mapstructure:"timeout"`
}

// Validate checks the URL when one is set.
func (c HomeConfig) Validate() error {
	if c.URL == "" {
		return nil
	}
	u, err := url.Parse(c.URL)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" {
		return fmt.Errorf("platform.home.url %q must be an absolute http(s) URL", c.URL)
	}
	return nil
}

const (
	homeSessionCookie   = "__nextgen_session"
	defaultHomeCacheTTL = time.Minute
	defaultHomeTimeout  = 5 * time.Second
	homeBodyLimit       = 1 << 20
)

// homeUsers is what the resolver needs from the user service: the shadow's
// lookup and its creation.
type homeUsers interface {
	GetUserByID(ctx context.Context, input service.GetUserInput) (*domain.User, error)
	CreateUser(ctx context.Context, input service.CreateUserInput) (*domain.User, error)
}

// HomeSessionResolver turns the identity home's session cookie into a
// session of this server. See the package comment above.
type HomeSessionResolver struct {
	base      string
	headers   map[string]string
	client    *http.Client
	ttl       time.Duration
	projectID string
	users     homeUsers
	teams     service.PersonalTeamEnsurer
	now       func() time.Time

	mu    sync.Mutex
	cache map[[sha256.Size]byte]homeEntry
}

type homeEntry struct {
	token   domain.Token
	session domain.Session
	until   time.Time
}

// NewHomeSessionResolver builds the resolver for cfg. platformProjectID is
// the project the home's users are provisioned into; teams may be nil.
func NewHomeSessionResolver(cfg HomeConfig, platformProjectID string, users homeUsers, teams service.PersonalTeamEnsurer) (*HomeSessionResolver, error) {
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	if cfg.URL == "" {
		return nil, errors.New("platform.home.url is empty")
	}
	if platformProjectID == "" {
		return nil, errors.New("accepting the identity home's sessions needs a platform project (platform.bootstrap_project)")
	}
	ttl := cfg.CacheTTL
	if ttl <= 0 {
		ttl = defaultHomeCacheTTL
	}
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = defaultHomeTimeout
	}
	return &HomeSessionResolver{
		base:      strings.TrimRight(cfg.URL, "/"),
		headers:   cfg.Headers,
		client:    &http.Client{Timeout: timeout},
		ttl:       ttl,
		projectID: platformProjectID,
		users:     users,
		teams:     teams,
		now:       time.Now,
		cache:     map[[sha256.Size]byte]homeEntry{},
	}, nil
}

// homeSession is what GET /sessions/me of the home answers, as far as the
// resolver reads it.
type homeSession struct {
	SessionID string `json:"session_id"`
	State     string `json:"state"`
	UserID    string `json:"user_id"`
	User      struct {
		Identifier         string `json:"identifier"`
		IdentifierProperty string `json:"identifier_property"`
		Display            string `json:"display"`
	} `json:"user"`
	ExpiresAt time.Time `json:"expires_at"`
}

// homeUser is what GET /users/me of the home answers, as far as the shadow
// needs it.
type homeUser struct {
	ID         string         `json:"id"`
	Schema     string         `json:"schema"`
	Attributes map[string]any `json:"attributes"`
}

// Resolve answers the session token and the session the home's cookie
// stands for in this server, provisioning the user's shadow on first sight.
// A cookie the home does not vouch for yields domain.ErrSessionTokenInvalid.
func (r *HomeSessionResolver) Resolve(ctx context.Context, cookie string) (*domain.Token, *domain.Session, error) {
	if cookie == "" {
		return nil, nil, domain.ErrSessionTokenInvalid()
	}
	key := sha256.Sum256([]byte(cookie))
	if token, session, ok := r.cached(key); ok {
		return token, session, nil
	}

	var remote homeSession
	if err := r.get(ctx, "/sessions/me", cookie, &remote); err != nil {
		return nil, nil, err
	}
	now := r.now()
	if remote.State != "active" || remote.UserID == "" || remote.SessionID == "" || !remote.ExpiresAt.After(now) {
		return nil, nil, domain.ErrSessionTokenInvalid()
	}
	if err := r.ensureShadow(ctx, cookie, remote.UserID); err != nil {
		return nil, nil, err
	}

	sessionID, userID, expires := remote.SessionID, remote.UserID, remote.ExpiresAt
	token := domain.Token{
		ProjectID: r.projectID,
		TokenID:   sessionID,
		UserID:    userID,
		Type:      domain.TokenTypeSessionToken,
		SessionID: &sessionID,
		CreatedAt: now,
		ExpiresAt: &expires,
	}
	// The home does not say how it verified the user; one verified factor is
	// what makes the synthesized session read as active (domain.Session.State).
	factor := &domain.AuthFactorPassword{}
	factor.SetLastVerifiedAt(now)
	session := domain.Session{
		ProjectID: r.projectID,
		ID:        sessionID,
		CreatedAt: now,
		UpdatedAt: now,
		ExpiresAt: expires,
		TokenID:   sessionID,
		UserID:    &userID,
		User: &domain.UserRef{
			UserID:             userID,
			Identifier:         remote.User.Identifier,
			IdentifierProperty: remote.User.IdentifierProperty,
			Display:            remote.User.Display,
		},
		Factors: []domain.AuthFactor{factor},
	}
	until := now.Add(r.ttl)
	if expires.Before(until) {
		until = expires
	}
	r.mu.Lock()
	r.cache[key] = homeEntry{token: token, session: session, until: until}
	r.mu.Unlock()
	return &token, &session, nil
}

func (r *HomeSessionResolver) cached(key [sha256.Size]byte) (*domain.Token, *domain.Session, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	entry, ok := r.cache[key]
	if !ok {
		return nil, nil, false
	}
	if !r.now().Before(entry.until) {
		delete(r.cache, key)
		return nil, nil, false
	}
	token, session := entry.token, entry.session
	return &token, &session, true
}

// ensureShadow makes sure the home's user exists here, under the same id,
// with the attributes the home reports, and holds its personal team.
func (r *HomeSessionResolver) ensureShadow(ctx context.Context, cookie, userID string) error {
	_, err := r.users.GetUserByID(ctx, service.GetUserInput{ProjectID: r.projectID, UserID: userID})
	switch {
	case err == nil:
	case errors.Is(err, domain.ErrUserNotFound()):
		var remote homeUser
		if err := r.get(ctx, "/users/me", cookie, &remote); err != nil {
			return err
		}
		if remote.ID != userID {
			return fmt.Errorf("the identity home's user %q is not the session's %q", remote.ID, userID)
		}
		if _, err := r.users.CreateUser(ctx, service.CreateUserInput{
			ProjectID:  r.projectID,
			SchemaURL:  remote.Schema,
			Attributes: remote.Attributes,
			ID:         userID,
		}); err != nil {
			return fmt.Errorf("provision the identity home's user %s: %w", userID, err)
		}
		slog.InfoContext(ctx, "provisioned the identity home's user", slog.String("user_id", userID), slog.String("project_id", r.projectID))
	default:
		return err
	}
	if r.teams == nil {
		return nil
	}
	return r.teams.EnsurePersonalTeam(ctx, r.projectID, userID)
}

// get calls the home with the cookie and decodes a 200 into out. A 401 is
// the home refusing the cookie; anything else is a failure of the home.
func (r *HomeSessionResolver) get(ctx context.Context, path, cookie string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, r.base+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	for name, value := range r.headers {
		req.Header.Set(name, value)
	}
	req.AddCookie(&http.Cookie{Name: homeSessionCookie, Value: cookie})
	resp, err := r.client.Do(req)
	if err != nil {
		return fmt.Errorf("identity home: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, homeBodyLimit))
	if err != nil {
		return fmt.Errorf("identity home: read %s: %w", path, err)
	}
	switch resp.StatusCode {
	case http.StatusOK:
		if err := json.Unmarshal(body, out); err != nil {
			return fmt.Errorf("identity home: decode %s: %w", path, err)
		}
		return nil
	case http.StatusUnauthorized:
		return domain.ErrSessionTokenInvalid()
	default:
		return fmt.Errorf("identity home answered %d to GET %s", resp.StatusCode, path)
	}
}

// remoteSessionKey carries the session the identity home vouched for, so the
// handlers that read the cookie's session serve it instead of the database.
type remoteSessionKey struct{}

func withRemoteSession(ctx context.Context, session *domain.Session) context.Context {
	return context.WithValue(ctx, remoteSessionKey{}, session)
}

func remoteSessionFromContext(ctx context.Context) (*domain.Session, bool) {
	session, ok := ctx.Value(remoteSessionKey{}).(*domain.Session)
	return session, ok && session != nil
}
